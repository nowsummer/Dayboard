'use strict';
// Rounded tooltips (2026-11-06 owner: 「설명 … 너무 정직한 직사각형이라 좀 올드해보이는 데 … 애플 디자인에 맞춰서」) and never a Windows one
// (2026-11-13 owner: 「이렇게 직사각형 형태로 설명 뜨는거 … 이런거 없도록 해달라고 했는데 또 있어」 — the month cell's 「두 번 누르면 일정 추가」
// came over its chips: only the hovered element's own title had been held). A title never stays on the page: app.js tipTake moves it to
// data-tip as it arrives, in every window, and the app's rounded tip shows the innermost data-tip under the pointer. The real app.js lines
// over tests/r50-F-harness.cjs with a MutationObserver the test fires by hand and timers it runs by hand; asserts take primitives only.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { harness, appLines, read } = require('./r50-F-harness.cjs');

const SVG = 'http://www.w3.org/2000/svg';
// The tip block of app.js, top to bottom.
const TIP_LINES = ["let tipNode=null,tipTimer=0,tipHost=null,tipText='',tipAt=null;", 'function tipParts(', 'const tipControl=', 'function tipTake(', 'function tipSay(', 'function tipFind(', 'function tipPlace(',
  'function tipHide(', 'function tipWait(', 'function tipArm(', 'function tipCheck(', 'new MutationObserver(list=>', "document.addEventListener('pointerover',tipArm,true);",
  "document.addEventListener('pointerout',e=>{if(!e.relatedTarget)tipAt=null;", "for(const type of ['pointerdown','keydown','wheel'])window.addEventListener(type,tipHide,true);",
  'let fieldTipNode=null', 'function fieldTipHide(', 'function fieldWords(', 'function fieldTip(', "for(const type of ['pointerdown','keydown','wheel'])window.addEventListener(type,fieldTipHide,true);",
  "document.addEventListener('submit',e=>{"];

function tipHarness({ before } = {}) {
  const windowListeners = {}, windowAll = {}, observers = [], timers = [];
  class FakeObserver { constructor(fn) { this.fn = fn; observers.push(this); } observe(target, options) { this.target = target; this.options = options; } disconnect() {} takeRecords() { return []; } }
  const h = harness({
    // every listener of a type runs (the hover tip's and the form message's)
    window: { addEventListener(type, fn) { (windowAll[type] ||= []).push(fn); windowListeners[type] = () => { for (const f of windowAll[type]) f(); }; }, removeEventListener() {} },
    MutationObserver: FakeObserver,
    setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length; }, clearTimeout: id => { if (timers[id - 1]) timers[id - 1].fn = null; },
  });
  if (before) before(h);
  h.loadApp(...TIP_LINES);
  const observer = observers[0];
  // what Chromium hands the observer after a change: the added subtree, or the element whose title was set
  const added = (...nodes) => observer.fn(nodes.map(n => ({ type: 'childList', target: n.parentNode, addedNodes: [n], removedNodes: [] })));
  const changed = n => observer.fn([{ type: 'attributes', target: n, attributeName: 'title', addedNodes: [], removedNodes: [] }]);
  const run600 = () => { for (const t of timers.splice(0)) if (t.fn && t.ms === 600) t.fn(); };
  const runAfter = ms => { for (const t of timers.splice(0)) if (t.fn && t.ms === ms) t.fn(); };
  const fire = (type, target, init = {}) => { const e = new h.dom.globals.Event(type, { bubbles: true, clientX: 40, clientY: 40, ...init }); for (const k of ['relatedTarget', 'buttons']) if (k in init) Object.defineProperty(e, k, { value: init[k] }); return target.dispatchEvent(e); };
  const tips = () => h.document.body.querySelectorAll('.tip');
  const tipText = () => { const t = tips(); return t.length === 1 ? t[0].textContent : `(${t.length} tips)`; };
  // the element and every ancestor: none may hold a title while the pointer is on it
  const titledChain = n => { const out = []; for (let e = n; e && e.nodeType === 1; e = e.parentNode) if (e.hasAttribute('title')) out.push(e.localName + '.' + e.className); return out.join(' ') || 'none'; };
  return { h, observer, added, changed, run600, runAfter, fire, tips, tipText, titledChain, windowListeners };
}
// A month cell as calendar.js draws one: its own hint, the day number's, a chip with the event's, 「+n개」 with none, the empty item area.
function monthCell(h, chipTip = '회의 · 오후 3:00') {
  const el = (tag, attrs, ...kids) => h.eval('h')(tag, attrs, ...kids);
  const chipTitle = el('span', { class: 'chip-title' }, '회의');
  const chip = el('span', { class: 'day-event timed', role: 'button', tabindex: 0, title: chipTip }, el('i', { class: 'bar' }), chipTitle);
  const more = el('button', { type: 'button', class: 'day-more' }, '+2개');
  const number = el('button', { type: 'button', class: 'day-number', title: '일간 보기' }, '14');
  const items = el('div', { class: 'day-items' }, chip, more);
  const cell = el('div', { class: 'calendar-day', role: 'button', tabindex: 0, title: '두 번 누르면 일정 추가' }, number, items);
  return { cell, chip, chipTitle, more, number, items };
}

test('a title never stays on the page: built, set later, already there or an SVG <title> — its words wait in data-tip; an empty title takes them away', () => {
  const t = tipHarness({ before: h => { const old = h.document.createElement('button'); old.setAttribute('title', '이미 있던 단추'); old.className = 'early'; h.app.append(old); } });
  assert.equal(t.h.app.querySelector('.early').hasAttribute('title'), false, 'the page as it was when app.js ran: swept once');
  assert.equal(t.h.app.querySelector('.early').getAttribute('data-tip'), '이미 있던 단추');
  assert.equal(t.observer.target === t.h.document.documentElement, true, 'the whole page');
  assert.equal(JSON.stringify(t.observer.options), JSON.stringify({ subtree: true, childList: true, attributes: true, attributeFilter: ['title'] }));
  const c = monthCell(t.h);
  const svg = t.h.document.createElementNS(SVG, 'svg'), svgTitle = t.h.document.createElementNS(SVG, 'title'); svgTitle.append('기호의 뜻'); svg.append(svgTitle);
  const form = t.h.eval('h')('form', { class: 'dialog-body' }, t.h.eval('h')('input', { name: 'name' }));
  c.items.append(svg); t.h.app.append(c.cell, form);
  assert.equal(c.cell.getAttribute('title'), '두 번 누르면 일정 추가', 'before the observer runs (the same task that built it)');
  t.added(c.cell, form);
  assert.equal(t.h.document.querySelectorAll('[title]').length, 0, 'no title anywhere');
  assert.equal([c.cell, c.chip, c.number].map(n => n.getAttribute('data-tip')).join(' | '), '두 번 누르면 일정 추가 | 회의 · 오후 3:00 | 일간 보기');
  assert.equal(c.more.hasAttribute('data-tip'), false, '「+n개」 has words of its own only in its text');
  assert.equal(svg.querySelectorAll('title').length, 0, 'the SVG <title> is gone');
  assert.equal(svg.getAttribute('data-tip'), '기호의 뜻', 'its words are the svg\'s hint');
  assert.equal(form.noValidate, true, 'a form checks its fields itself (no square message tip on an invalid field)');
  c.chip.title = '회의 · 오후 4:00'; t.changed(c.chip);
  assert.equal(c.chip.hasAttribute('title'), false, '.title= on the page: moved too');
  assert.equal(c.chip.getAttribute('data-tip'), '회의 · 오후 4:00');
  c.chip.title = ''; t.changed(c.chip);
  assert.equal(c.chip.hasAttribute('title') || c.chip.hasAttribute('data-tip'), false, 'an empty title: no hint');
});

test('only the innermost hint shows: a chip its own words, the cell\'s empty part 「두 번 누르면 일정 추가」, a control without words none, a field its label\'s', () => {
  const t = tipHarness();
  const c = monthCell(t.h);
  const label = t.h.eval('h')('label', { class: 'checkbox-field', title: '이 PC에만 있는 자료를 저장해요.' }, t.h.eval('h')('input', { type: 'checkbox', class: 'switch' }), t.h.eval('h')('span', {}, '자동 백업'));
  t.h.app.append(c.cell, label); t.added(c.cell, label);
  const over = (target, init) => { t.fire('pointerover', target, init); t.run600(); return t.tipText(); };
  assert.equal(over(c.chipTitle), '회의 · 오후 3:00', 'over the chip: the event\'s own words');
  assert.equal(t.titledChain(c.chipTitle), 'none', 'neither the chip nor its cell keeps a title');
  assert.equal(over(c.items), '두 번 누르면 일정 추가', 'the cell\'s empty part');
  assert.equal(over(c.number), '일간 보기');
  assert.equal(over(c.more), '(0 tips)', '「+n개」 borrows nothing from its cell');
  assert.equal(over(c.chip.querySelector('.bar')), '회의 · 오후 3:00', 'any part of the chip');
  assert.equal(over(label.querySelector('input')), '이 PC에만 있는 자료를 저장해요.', 'a switch in a row: the row\'s words');
  assert.equal(over(label.querySelector('span')), '이 PC에만 있는 자료를 저장해요.');
  t.fire('pointerover', c.chipTitle); t.fire('pointerout', c.chipTitle, { relatedTarget: c.items }); t.fire('pointerover', c.items); t.run600();
  assert.equal(t.tipText(), '두 번 누르면 일정 추가', 'one tip at a time');
});

test('a click, a key or the wheel hides the tip and brings no title back; it comes again when the pointer moves on', () => {
  const t = tipHarness();
  const c = monthCell(t.h);
  t.h.app.append(c.cell); t.added(c.cell);
  for (const kind of ['pointerdown', 'keydown', 'wheel']) {
    t.fire('pointerover', c.chipTitle); t.run600();
    assert.equal(t.tipText(), '회의 · 오후 3:00', kind);
    t.windowListeners[kind]();
    assert.equal(t.tips().length, 0, `${kind}: hidden`);
    assert.equal(t.titledChain(c.chipTitle), 'none', `${kind}: the pointer still there, no title for Windows to draw`);
    t.fire('pointermove', c.chipTitle); t.run600();
    assert.equal(t.tips().length, 0, `${kind}: a move event to the same spot is no move`);
    t.fire('pointermove', c.chipTitle, { clientX: 41 }); t.run600();
    assert.equal(t.tipText(), '회의 · 오후 3:00', `${kind}: the pointer moves again, the rounded tip comes back`);
    t.fire('pointerout', c.chipTitle, { relatedTarget: null });
  }
  t.fire('pointerover', c.chipTitle); t.run600(); t.windowListeners.blur();
  assert.equal(t.tips().length, 0, 'the window\'s blur');
  t.fire('pointerover', c.chipTitle, { buttons: 1 }); t.run600();
  assert.equal(t.tips().length, 0, 'not while a button is held (a drag)');
});

test('drawn anew under the pointer (render()): the tip stays on the new element when it says the same, waits on it when it says else; new words show', () => {
  const t = tipHarness();
  let c = monthCell(t.h);
  t.h.app.append(c.cell); t.added(c.cell);
  t.fire('pointerover', c.chipTitle); t.run600();
  const redraw = chipTip => { const next = monthCell(t.h, chipTip); t.h.app.replaceChildren(next.cell); t.h.document.elementFromPoint = () => next.chipTitle; t.added(next.cell); return next; };
  c = redraw('회의 · 오후 3:00');
  assert.equal(t.tipText(), '회의 · 오후 3:00', 'still shown');
  assert.equal(t.h.eval('tipHost') === c.chip, true, 'on the chip now on the page');
  c.chip.title = '회의 · 오후 3:30'; t.changed(c.chip);
  assert.equal(t.tipText(), '회의 · 오후 3:30', 'its words changed: the tip says the new ones');
  c = redraw('점심 · 오후 12:00');
  assert.equal(t.tips().length, 0, 'another element there: the old words go');
  t.run600();
  assert.equal(t.tipText(), '점심 · 오후 12:00', 'and its own come after the rest');
  assert.equal(t.titledChain(c.chipTitle), 'none');
  t.fire('pointerout', c.chipTitle, { relatedTarget: null });
  c = redraw('회의 · 오후 3:00'); t.run600();
  assert.equal(t.tips().length, 0, 'the pointer left the window: nothing comes back');
});

// novalidate keeps Chromium from putting an invalid field's message in a square tip under the pointer, and reportValidity would draw it in
// Chromium's square bubble with an orange 「!」 (2026-11-14 review of the 11-13 batch: an empty 새 목록 name, Enter): the form is checked with
// checkValidity, which draws nothing, and the first invalid field's message shows in the app's rounded tip under it.
test('a form checks its fields itself on submit: never reportValidity\'s square bubble — the first invalid field takes the focus and its message shows in the rounded tip under it', () => {
  const t = tipHarness();
  const el = (tag, attrs, ...kids) => t.h.eval('h')(tag, attrs, ...kids);
  const says = (n, message) => { for (const [k, v] of [['willValidate', true], ['validity', { valid: !message }], ['validationMessage', message]]) Object.defineProperty(n, k, { value: v, configurable: true }); };
  const ok = el('input', { name: 'ok' }), name = el('input', { name: 'name' }), count = el('input', { name: 'count', type: 'number' });
  const date = el('input', { name: 'start' }), face = el('button', { type: 'button', class: 'form-input date-button' }, '11월 16일 (월)'); date.hidden = true;
  const button = el('button', { type: 'submit' }, '목록 추가'); Object.defineProperty(button, 'willValidate', { value: false });
  const form = el('form', {}, ok, name, count, el('div', { class: 'date-field' }, date, face), button);
  let valid = false, reported = 0, checked = 0, sent = 0;
  form.reportValidity = () => { reported++; return valid; };
  form.checkValidity = () => { checked++; return valid; };
  let fields = [ok, name, count, date, button]; Object.defineProperty(form, 'elements', { get: () => fields });
  says(ok, ''); says(name, '이 입력란을 작성하세요.'); says(count, '값은 1 이상이어야 합니다.'); says(date, '');
  form.addEventListener('submit', e => { e.preventDefault(); sent++; });
  t.h.app.append(form); t.added(form);
  assert.equal(form.noValidate, true);
  const submit = (trusted, submitter) => { const e = new t.h.dom.globals.Event('submit', { bubbles: true, submitter }); Object.defineProperty(e, 'isTrusted', { value: trusted }); form.dispatchEvent(e); return e.defaultPrevented; };
  const message = () => { const m = t.h.document.body.querySelectorAll('.field-tip'); return m.length === 1 ? `${m[0].textContent} | ${m[0].getAttribute('role')} | ${m[0].classList.contains('tip')} | ${m[0].style.left} ${m[0].style.top}` : `(${m.length})`; };
  const focused = () => t.h.document.activeElement?.getAttribute('name') || t.h.document.activeElement?.className || '';

  assert.equal(submit(true), true);
  assert.equal(`${checked}/${reported}/${sent}`, '1/0/0', 'an invalid form: checked without reportValidity (no square bubble), the dialog does not run');
  assert.equal(message(), '이 입력란을 작성하세요. | alert | true | 4px 16px', 'the first invalid field\'s message in the rounded tip, 6px under the field');
  assert.equal(focused(), 'name', 'the first invalid field has the keyboard');
  // it goes as the hover tip does — a click, a key, the wheel, the window's blur — or by itself after 5 s, as Chromium's did
  for (const kind of ['keydown', 'pointerdown', 'wheel', 'blur']) {
    submit(true); assert.equal(message().startsWith('이 입력란을 작성하세요.'), true, kind);
    t.windowListeners[kind](); assert.equal(message(), '(0)', `${kind}: gone`);
  }
  submit(true); t.runAfter(5000); assert.equal(message(), '(0)', 'after 5 s: gone');
  submit(true); form.remove(); t.observer.fn([{ type: 'childList', target: t.h.app, addedNodes: [], removedNodes: [form] }]);
  assert.equal(message(), '(0)', 'its field left the page (the dialog closed): gone');
  t.h.app.append(form); t.added(form);
  says(name, ''); submit(true);
  assert.equal(`${message().split(' | ')[0]} / ${focused()}`, '값은 1 이상이어야 합니다. / count', 'the next invalid field');
  says(count, ''); says(date, '이 입력란을 작성하세요.'); submit(true);
  assert.equal(`${message().split(' | ')[0]} / ${focused()}`, '이 입력란을 작성하세요. / form-input date-button', 'a hidden field (a date behind its words): the words in its box take the keyboard and the message');
  const plain = el('input', { name: 'plain' }); plain.hidden = true; const box = el('div', { class: 'plain-box' }, plain); form.append(box); fields = [...fields, plain];
  says(date, ''); says(plain, '이 입력란을 작성하세요.'); submit(true);
  assert.equal(`${message().split(' | ')[0]} / ${t.h.eval('fieldTipAt') === box}`, '이 입력란을 작성하세요. / true', 'another hidden field: under the nearest box on screen');
  says(plain, ''); t.windowListeners.keydown();
  const before = `${checked}/${reported}/${sent}`;
  valid = true; says(date, ''); submit(true); assert.equal(`${message()} ${sent}`, '(0) 1', 'a valid one goes on, no message');
  valid = false; submit(false); assert.equal(`${message()} ${sent}`, '(0) 2', 'a submit event made by script is not checked (Chromium neither)');
  submit(true, { formNoValidate: true }); assert.equal(`${message()} ${sent}`, '(0) 3', 'a formnovalidate button');
  assert.equal(`${before} → ${checked}/${reported}`, '10/0/0 → 11/0', 'reportValidity is never called');
});

test('source: a form is never checked with reportValidity (Chromium\'s square bubble with 「!」), anywhere in the renderer', () => {
  for (const file of ['renderer/app.js', 'renderer/calendar.js', 'renderer/help.js', 'renderer/glass.js', 'renderer/notefind.js']) {
    const code = read(file).split(/\r?\n/).filter(l => !l.trimStart().startsWith('//')).join('\n').replace(/\/\*[\s\S]*?\*\//g, '');
    assert.equal((code.match(/reportValidity\s*\(/g) || []).length, 0, `${file}: reportValidity()`);
  }
});

// A title was what a screen reader read as the element's description, or its name when it had nothing else (2026-11-14 review B1: after
// tipTake moved it to data-tip, 「오늘 (T)」, a chip's whole time and the calendar button's hint were read no more): tipSay keeps them in
// aria-description, or aria-label on a control with no words of its own; neither draws a tooltip.
test('what a screen reader read from a title stays: the hint is the description, or the name of a control with no words of its own', () => {
  const t = tipHarness();
  const el = (tag, attrs, ...kids) => t.h.eval('h')(tag, attrs, ...kids);
  const today = el('button', { type: 'button', title: '오늘 (T)' }, '오늘');
  const gear = el('button', { type: 'button', 'aria-label': '설정', title: '설정 (Ctrl+,)' }, el('i', {}));
  const bare = el('button', { type: 'button', title: '닫기' }, el('i', {}));
  const c = monthCell(t.h, '주간 회의 · 오전 10:00 ~ 오전 11:00');
  const mark = el('span', { class: 'note-mark', title: '메모 있음' }, el('i', {}));
  const same = el('button', { type: 'button', title: '추가' }, ' 추가 ');
  const own = el('button', { type: 'button', title: '설명', 'aria-description': '자기 설명' }, '단추');
  const head = el('header', { class: 'widget-head', title: '11월 14일 토요일' }, el('strong', {}, '오늘'), el('strong', {}, '3'));
  const svg = t.h.document.createElementNS(SVG, 'svg'), svgTitle = t.h.document.createElementNS(SVG, 'title'); svgTitle.append('기호의 뜻'); svg.append(svgTitle);
  const status = el('span', { id: 'note-save-status' }, '저장 안 됨');
  t.h.app.append(today, gear, bare, c.cell, mark, same, own, head, svg, status); t.added(today, gear, bare, c.cell, mark, same, own, head, svg, status);
  const said = n => `${n.getAttribute('aria-label') ?? '-'} | ${n.getAttribute('aria-description') ?? '-'}`;
  assert.equal(said(today), '- | 오늘 (T)', 'a button with words: the hint is its description');
  assert.equal(said(gear), '설정 | 설정 (Ctrl+,)', 'its own name stays, the hint with the key is the description');
  assert.equal(said(bare), '닫기 | -', 'a control with no words of its own: the hint is its name');
  assert.equal(said(c.chip), '- | 주간 회의 · 오전 10:00 ~ 오전 11:00', 'a chip: its whole time');
  assert.equal(said(c.cell), '- | 두 번 누르면 일정 추가');
  assert.equal(said(mark), '- | 메모 있음', 'a mark that is no control: a description, as Chromium read its title');
  assert.equal(said(same), '- | -', 'the hint says the words it shows: nothing twice');
  assert.equal(said(own), '- | 자기 설명', 'its own description stays');
  assert.equal(said(head), '- | 11월 14일 토요일');
  assert.equal(said(svg), '기호의 뜻 | -', 'an SVG <title>: the svg\'s name');
  assert.equal(t.h.document.querySelectorAll('[title]').length, 0, 'and still no title on the page');
  // the words change with the title, and go with it
  c.chip.title = '주간 회의 · 오전 10:00 ~ 오전 11:30'; t.changed(c.chip);
  assert.equal(said(c.chip), '- | 주간 회의 · 오전 10:00 ~ 오전 11:30');
  c.chip.title = ''; t.changed(c.chip); bare.title = ''; t.changed(bare); gear.title = ''; t.changed(gear);
  assert.equal(`${said(c.chip)} / ${said(bare)} / ${said(gear)}`, '- | - / - | - / 설정 | -', 'an empty title: the words it gave go, its own name stays');
  // paintNoteStatus takes a title away with removeAttribute('title') and removeAttribute('data-tip')
  status.title = '동기화하지 못했어요.'; t.changed(status);
  assert.equal(said(status), '- | 동기화하지 못했어요.');
  status.removeAttribute('title'); status.removeAttribute('data-tip'); t.changed(status);
  assert.equal(said(status), '- | -', 'title and data-tip taken away: the description goes too');
});

test('source: one mechanism for every window — the observer is top level in app.js, which the main window and every widget load, and nothing reads a title back', () => {
  const block = TIP_LINES.map(p => appLines.findIndex(l => l.startsWith(p)));
  assert.equal(block.every(i => i >= 0), true, 'the tip block: ' + TIP_LINES.filter((_, i) => block[i] < 0).join(', '));
  assert.equal(block.every((i, k) => k === 0 || i > block[k - 1]), true, 'in order');
  const obs = appLines[block[TIP_LINES.indexOf('new MutationObserver(list=>')]];
  assert.equal(obs.includes(".observe(document.documentElement,{subtree:true,childList:true,attributes:true,attributeFilter:['title']});tipTake(document.documentElement);"), true, 'the whole page, then one sweep of what is there');
  assert.equal(block.some(i => appLines[i].includes('isWidget')), false, 'no window left out');
  assert.equal(read('renderer/index.html').includes('<script src="app.js"></script>'), true);
  assert.equal(/<body[\s\S]*\stitle=/.test(read('renderer/index.html')), false, 'no title written in the page');
  const main = read('main.cjs');
  assert.equal((main.match(/\.load(File|URL)\(/g) || []).length, 2, 'two pages are loaded: the main window and a widget');
  assert.equal(main.includes('mainWindow.loadFile(rendererFile);') && main.includes('win.loadFile(rendererFile, { query: { widget: widget.type, id: widget.id } })'), true, 'both the same index.html');
  const take = appLines[block[TIP_LINES.indexOf('function tipTake(')]];
  for (const file of ['renderer/app.js', 'renderer/calendar.js', 'renderer/help.js', 'renderer/glass.js', 'renderer/notefind.js']) {
    const lines = read(file).split(/\r?\n/).filter(l => l !== take && !l.trimStart().startsWith('//'));
    const src = lines.join('\n');
    assert.equal((src.match(/(get|has)Attribute\('title'\)|(querySelector(All)?|closest|matches)(\?\.)?\(\s*['"`][^'"`]*\[title\b/g) || []).join(' '), '', `${file}: a title is read back (it is never on the page)`);
    assert.equal((src.match(/setAttribute\('title'/g) || []).length, 0, `${file}: a title put back`);
    for (const m of src.matchAll(/(\w+)\.removeAttribute\('title'\)/g)) assert.equal(src.slice(m.index, m.index + 120).includes(`${m[1]}.removeAttribute('data-tip')`), true, `${file}: ${m[0]} leaves the hint it had in data-tip`);
  }
});

test('the tip looks like the menus: rounded, the glass, 12px words, no pointer', () => {
  const css = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'styles.css'), 'utf8');
  const rule = css.match(/\n\.tip\{([^}]*)\}/);
  assert.equal(Boolean(rule), true);
  for (const part of ['position:fixed', 'border-radius:8px', 'font-size:12px', 'pointer-events:none', 'background:rgb(from var(--glass) r g b / .97)']) assert.equal(rule[1].includes(part), true, part);
});
