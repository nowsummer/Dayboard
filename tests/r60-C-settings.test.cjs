'use strict';
// The settings sheet as macOS System Settings (2026-11-02 review app-design-4/-6/-8, usability-2; owner decisions of the round):
// three grouped cards of label-left/control-right rows, the widget look only on the 위젯 tab, no 닫기 bar, the update card only for
// news with 「버전 · 최신」 and 업데이트 확인 by the name otherwise, and one switch-row size in every dialog. The real renderer lines
// run over the small DOM of tests/r50-F-dom.cjs; the smoke (tests/ui-smoke.cjs settings-sheet-scroll) and
// artifacts/r60-fix/C/measure.cjs check the drawn sheet.
const test = require('node:test');
const assert = require('node:assert/strict');
const { harness, appLine } = require('./r50-F-harness.cjs');
const { computed } = require('./r50-F-css.cjs');

const settingsLine = () => appLine('function openSettings(');

test('openSettings: three groups in the System Settings order, no widget look, no 닫기 bar, the auto-check switch with the others', () => {
  const src = settingsLine();
  const groups = src.split("h('div',{class:'settings-group'}").slice(1).map(part => [...part.matchAll(/tr\('([^']+)'\)/g)].map(m => m[1]));
  assert.equal(groups.length, 3, 'three grouped cards');
  assert.deepEqual(groups[0], ['언어', '화면 모드', '시간 표시', '글자 크기'], 'general first (글자 크기: r60-X, 2026-11-02 owner: text size)');
  assert.deepEqual(groups[1], ['할 일 화면 메모', '새 할 일 기본 목록', '새 일정 기본 달력', '새 위젯 표시 방식'], 'this app: its screens, then new items');
  assert.deepEqual(groups[2].slice(0, 4), ['일정의 알림 시간에 Windows 알림을 띄워요.', '일정 알림 표시', 'Windows 시작 시 실행', '새 버전 자동 확인']);
  for (const gone of ["tr('위젯 화면 모드')", "tr('위젯 유리 효과')", 'glass-ticks-settings', 'widgetThemeSelect()', "type:'range'"]) assert.ok(!src.includes(gone), `${gone} left the sheet (the 위젯 tab has it)`);
  assert.match(src, /h\('footer',\{class:'dialog-footer bare'\}\)\),false,\{live:true\}\)/, 'an empty footer, still live');
  assert.ok(!/dialog-footer'\},btn\(tr\('닫기'\)/.test(src), 'no 닫기 button');
  assert.ok(src.indexOf("class:'settings-links'") < src.indexOf("class:'settings-contact'") && src.indexOf("class:'settings-contact'") < src.indexOf('dialog-footer bare'), '문의 stays last');
});

// The update pieces of the sheet: the version line, 업데이트 확인 by the name, the card under it.
function updateSheet(update) {
  const h = harness();
  h.context.state.app = { version: '1.2.6', update };
  h.context.state.settings = { autoUpdate: true };
  h.loadApp('function updateStatusText(', 'function updateBlock(', 'function refreshUpdateBlock(');
  const dialog = h.document.createElement('div'); dialog.className = 'dialog'; dialog.setAttribute('tabindex', '-1');
  const body = h.document.createElement('div'); body.className = 'dialog-body settings-body';
  const brand = h.eval("h('div',{class:'settings-brand'},h('div',{},h('strong',{},'Dayboard'),h('small',{id:'settings-version'},versionLine())),updateCheckButton())");
  const group = h.document.createElement('div'); group.className = 'settings-group';
  body.append(brand); const card = h.eval('updateBlock()'); if (card) body.append(card); body.append(group);
  dialog.append(body); h.modalRoot.append(dialog);
  // replaceWith/after for this small DOM (a browser has them)
  const proto = Object.getPrototypeOf(brand);
  if (!proto.replaceWith) proto.replaceWith = function (n) { const p = this.parentNode; p.insertBefore(n, this); this.remove(); };
  if (!proto.after) proto.after = function (n) { const p = this.parentNode; const i = p.childNodes.indexOf(this); p.insertBefore(n, p.childNodes[i + 1] || null); };
  const set = u => { h.context.state.app = { ...h.context.state.app, update: u }; h.eval('refreshUpdateBlock()'); };
  const view = () => ({ line: h.document.querySelector('#settings-version').textContent, check: (b => b ? !b.hidden : null)(h.document.querySelector('#settings-check')),
    card: (c => c ? c.textContent : null)(h.document.querySelector('#update-block')), order: body.childNodes.map(n => n.className || n.id), focus: h.document.activeElement?.id || h.document.activeElement?.className || '' });
  return { h, set, view, body };
}

test('updateBlock: a quiet updater costs no row — 「버전 · 최신」 and 업데이트 확인 by the name; the card only for news', () => {
  for (const [update, line] of [[{ status: 'up-to-date', enabled: true }, '버전 1.2.6 · 최신'], [{ status: 'idle', enabled: false }, '버전 1.2.6'], [{ status: 'checking' }, '버전 1.2.6 · 확인 중…']]) {
    const { view } = updateSheet(update);
    assert.deepEqual({ ...view(), focus: undefined }, { line, check: true, card: null, order: ['settings-brand', 'settings-group'], focus: undefined }, update.status);
  }
  const available = updateSheet({ status: 'available', selfUpdating: true, canDownload: true, latestVersion: '9.9.9' }).view();
  assert.equal(available.check, false, '업데이트 확인 gives way to the card');
  assert.equal(available.card, '9.9.9 버전을 받을 수 있어요.내려받기새 기능 보기', 'status, 내려받기, 새 기능 보기 — no switch');
  for (const update of [{ status: 'error', error: 'network' }, { status: 'downloaded', downloadedVersion: '9.9.9', canInstall: true, selfUpdating: true }, { status: 'downloading', latestVersion: '9.9.9', percent: 40, selfUpdating: true }, { status: 'unsupported' }]) {
    assert.ok(updateSheet(update).view().card, `${update.status} opens the card`);
  }
  const none = updateSheet(null).view();
  assert.deepEqual([none.line, none.check, none.card], ['버전 1.2.6', null, null], 'no updater: the version alone, as before');
  const h = harness(); h.context.state.app = { version: '1.2.6', update: { status: 'up-to-date' } }; h.context.state.settings = {};
  h.loadApp('function updateStatusText(', 'function updateBlock(');
  assert.ok(!h.eval('updateBlock()')?.querySelector?.('input'), 'the auto-check switch is no longer in the card');
});

test('refreshUpdateBlock: the card comes and goes in place under the name, and the keyboard is never dropped on the page', () => {
  const sheet = updateSheet({ status: 'idle', enabled: true });
  sheet.set({ status: 'checking' });
  assert.deepEqual([sheet.view().line, sheet.view().card], ['버전 1.2.6 · 확인 중…', null], 'a check from the name keeps the sheet still');
  sheet.set({ status: 'available', selfUpdating: true, canDownload: true, latestVersion: '9.9.9' });
  assert.deepEqual(sheet.view().order, ['settings-brand', 'update-block', 'settings-group'], 'news opens the card right under the name');
  assert.equal(sheet.view().check, false);
  // a retry from an error card: the card stays while the check runs, then leaves with the focus going to 업데이트 확인
  const retry = updateSheet({ status: 'error', error: 'network' });
  retry.h.document.querySelector('#update-block .button').focus();
  retry.set({ status: 'checking' });
  assert.equal(retry.view().card, '새 버전을 확인하는 중…업데이트 확인', 'the card keeps its place while it checks');
  assert.equal(retry.view().focus, 'dialog', 'its busy button hands the keyboard to the sheet, not the page');
  retry.h.document.querySelector('#update-block .button').disabled = false; retry.h.document.querySelector('#update-block .button').focus();
  retry.set({ status: 'up-to-date', enabled: true });
  assert.deepEqual([retry.view().line, retry.view().card, retry.view().check, retry.view().focus], ['버전 1.2.6 · 최신', null, true, 'settings-check']);
});

test('styles: 44px rows with 28px borderless selects and 13px labels in the groups, one switch-row size, an empty footer', () => {
  const h = harness();
  const el = (tag, cls, parent) => { const n = h.document.createElement(tag); if (cls) n.className = cls; if (parent) parent.append(n); return n; };
  const dialog = el('div', 'dialog', h.modalRoot), body = el('div', 'dialog-body settings-body', dialog), group = el('div', 'settings-group', body);
  const row = el('label', 'checkbox-field', group), field = el('label', 'field', group), label = el('span', '', field), select = el('select', 'form-input', field);
  const footer = el('footer', 'dialog-footer bare', body);
  assert.equal(computed(row, 'min-height').value, '44px');
  assert.equal(computed(row, 'display').value, 'grid');
  // a value and its chevron on the card, no box inside the card (r60-apple S1, 2026-11-02 owner: Apple surfaces; was a 32px white box)
  assert.equal(computed(select, 'min-height').value, '28px');
  assert.equal(computed(select, 'width').value, 'auto', 'a select hugs its value');
  assert.equal(computed(label, 'font-size').value, '13px');
  assert.equal(computed(label, 'color').value, 'var(--text)');
  assert.equal(computed(group, 'background').value, 'var(--field)');
  assert.equal(computed(footer, 'padding').value, '0');
  // the task editor's 「중요한 할 일」 and the event dialog's 「하루 종일」: the settings' size, not 12px on a 20px row
  const form = el('div', 'dialog-body', el('div', 'dialog', h.app)), important = el('label', 'checkbox-field', form);
  assert.equal(computed(important, 'font-size').value, '13px');
  assert.equal(computed(important, 'min-height').value, '32px');
  h.document.body.className = 'widget-body';
  assert.equal(computed(important, 'font-size').value, '12px', 'widget windows keep their 12px forms');
});

// ---- after the independent review of r60-C (2026-11-02): long values, the keyboard on 업데이트 확인, the account blocks ----
const { read } = require('./r50-F-harness.cjs');

test('long values: the label keeps one line, the select may take the rest of the row and ends in 「…」, a hidden default list reads short when closed', () => {
  const src = settingsLine();
  const fit = /\[([\w,]+)\]\.forEach\(s=>s\.prepend\(h\('button',\{type:'button'\},h\('selectedcontent'\)\)\)\)/.exec(src);
  assert.ok(fit, 'the selects draw their value through <selectedcontent> (base-select has no ellipsis of its own)');
  assert.deepEqual(fit[1].split(',').sort(), ['clock', 'def', 'defCal', 'language', 'mode', 'sidePick', 'size', 'theme'], 'every select of the sheet');
  assert.ok(src.indexOf('.forEach(s=>s.prepend(') < src.indexOf("modal(tr('설정')"), 'before the sheet is drawn');
  assert.match(src, /hiddenDef\?h\('option',\{value:hiddenDef\.id\},h\('span',\{\},listVisual\(hiddenDef\)\.title\+' · '\+tr\('숨김'\),h\('span',\{class:'option-more'\},' · '\+tr\('다시 표시할 때까지 자동 목록 사용'\)\)\)\):null/,
    'closed 「{title} · 숨김」, the why in the open list only');
  const h = harness();
  const el = (tag, cls, parent) => { const n = h.document.createElement(tag); if (cls) n.className = cls; if (parent) parent.append(n); return n; };
  const body = el('div', 'dialog-body settings-body', el('div', 'dialog', h.modalRoot)), group = el('div', 'settings-group', body);
  const field = el('label', 'field', group); el('span', '', field); const select = el('select', 'form-input', field);
  const value = el('selectedcontent', '', el('button', '', select)), more = el('span', 'option-more', el('span', '', value));
  assert.equal(computed(field, 'grid-template-columns').value, 'auto minmax(min(168px,100%),1fr)', 'the label at its own width, the value column at least 168px');
  assert.equal(computed(select, 'max-width').value, '100%', 'no 240px cap that cut titles mid-word');
  assert.equal(computed(select, 'justify-self').value, 'end');
  assert.equal(computed(select, 'min-width').value, '0', 'the borderless value hugs its text at the end of the column (r60-apple S1); the 168px column keeps the row from jumping');
  for (const [prop, want] of [['display', 'block'], ['min-width', '0'], ['overflow', 'hidden'], ['white-space', 'nowrap'], ['text-overflow', 'ellipsis']]) assert.equal(computed(value, prop).value, want, `selectedcontent ${prop}`);
  assert.equal(computed(more, 'display').value, 'none', 'the closed select leaves the explanation out');
  assert.match(read('renderer/i18n.js'), /'다시 표시할 때까지 자동 목록 사용':'the automatic list is used until it is shown again',/);
  // Apple's own names (Reminders' Default List, Calendar's Default Calendar): no English label needs two lines beside its value
  for (const [ko, en] of [['새 할 일 기본 목록', 'Default list'], ['새 일정 기본 달력', 'Default calendar']]) assert.ok(read('renderer/i18n.js').includes(`'${ko}':'${en}'`), en);
});

test('refreshUpdateBlock: 업데이트 확인 by the name hands the keyboard to the card it opens, and the version line is a status', () => {
  assert.match(settingsLine(), /h\('small',\{id:'settings-version',role:'status'\},versionLine\(\)\)/, '「· 확인 중…」 and 「· 최신」 are announced');
  for (const [news, to] of [[{ status: 'available', selfUpdating: true, canDownload: true, latestVersion: '9.9.9' }, '내려받기'], [{ status: 'error', error: 'network' }, '업데이트 확인']]) {
    const sheet = updateSheet({ status: 'idle', enabled: true });
    sheet.h.document.querySelector('#settings-check').focus();
    sheet.set({ status: 'checking' });
    assert.equal(sheet.view().focus, 'settings-check', 'the check runs with the keyboard where it was');
    sheet.set(news);
    const at = sheet.h.document.activeElement;
    assert.ok(sheet.h.document.querySelector('#update-block').contains(at) && at.textContent === to, `${news.status}: the keyboard moves into the card (${at?.id || at?.className}), not to the page`);
  }
  const quiet = updateSheet({ status: 'idle', enabled: true });
  quiet.h.document.querySelector('#settings-check').focus();
  quiet.set({ status: 'checking' }); quiet.set({ status: 'up-to-date', enabled: true });
  assert.deepEqual([quiet.view().line, quiet.view().focus], ['버전 1.2.6 · 최신', 'settings-check'], 'nothing new: it stays on 업데이트 확인');
});

test('styles: 목록에 표시할 계정 · 숨긴 목록 read as a captioned list of switch rows inside the card, not a row without its control', () => {
  const h = harness();
  const el = (tag, cls, parent) => { const n = h.document.createElement(tag); if (cls) n.className = cls; if (parent) parent.append(n); return n; };
  const group = el('div', 'settings-group', el('div', 'dialog-body settings-body', el('div', 'dialog', h.modalRoot)));
  const block = el('div', 'field section-visibility', group), caption = el('span', '', block), sub = el('label', 'checkbox-field', block);
  assert.equal(computed(caption, 'font-size').value, '12px');
  assert.equal(computed(caption, 'color').value, 'var(--secondary)', 'a caption, not a 13px row label');
  assert.equal(computed(sub, 'min-height').value, '36px');
  assert.equal(computed(sub, 'margin').value, '0');
  assert.equal(computed(block, 'gap').value, '0');
  // the hairline between the switch rows (a + rule this small DOM skips): from the caption's edge to the card's right edge, as the rows'
  assert.match(read('renderer/styles.css'), /\.settings-body \.settings-group>\.section-visibility>\.checkbox-field\+\.checkbox-field::before\{content:"";position:absolute;left:0;right:-16px;top:0;height:1px;background:var\(--line\)\}/);
});

test('refreshUpdateBlock writes the version line only when its text changes, so the live region is not read again (2026-11-02 r60 carry-over C-1)', () => {
  // Every state broadcast (a switch in the open sheet, a sync tick) swapped the text node of the role=status line, which a screen
  // reader may announce again as 「버전 1.2.6」. Counts writes through the node's own textContent; compares numbers and strings only.
  const sheet = updateSheet({ status: 'up-to-date', enabled: true });
  const line = sheet.h.document.querySelector('#settings-version');
  let owner = Object.getPrototypeOf(line), desc = null;
  for (let i = 0; i < 10 && owner && !desc; i++) { desc = Object.getOwnPropertyDescriptor(owner, 'textContent'); owner = Object.getPrototypeOf(owner); }
  assert.ok(Boolean(desc && desc.set && desc.get), 'the small DOM has a textContent accessor');
  let writes = 0;
  Object.defineProperty(line, 'textContent', { configurable: true, get() { return desc.get.call(this); }, set(v) { writes++; desc.set.call(this, v); } });
  const before = line.textContent;
  sheet.set({ status: 'up-to-date', enabled: true });
  sheet.set({ status: 'up-to-date', enabled: true });
  assert.equal(writes, 0, `unchanged 「${before}」: no write`);
  sheet.set({ status: 'checking' });
  assert.equal(writes, 1, 'a new status: one write');
  assert.equal(line.textContent, '버전 1.2.6 · 확인 중…');
});
