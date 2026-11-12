'use strict';
// 글자 크기 (2026-11-02 owner: 「프로그램 내 할 일, 달력 등이나 위젯의 할 일 등의 글자 크기가 좀 작아진 느낌」 → 「위젯 등에서 글자 크기 설정할 수
// 있는 기능 필요하면 도입해줘도 좋아」): one per-PC setting for the main window (settings.textSize, Chromium zoom from main) and one for every
// widget (settings.widgetTextSize, CSS zoom on the card's content), 기본 / 크게 / 더 크게 = 1 / 1.125 / 1.25. The store heals, settings:update
// takes the three values only, the renderer's keys, the ? list, the two selects, the CSS hooks and the zoomed narrow window (720 CSS px).
// Real code over the small DOM of tests/r50-F-dom.cjs and in VMs; asserts compare primitives only. The drawn windows: tests/ui-smoke.cjs
// (text-size-zoom-widget-content) and artifacts/r60-fix/X/measure.cjs.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { harness, appLine, D, I } = require('./r50-F-harness.cjs');
const { createStore, initialState, validateState } = require('../lib/store.cjs');
const i18n = require('../lib/i18n.cjs');

const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
const main = read('main.cjs'), css = read('renderer/styles.css'), app = read('renderer/app.js'), glass = read('renderer/glass.js');

test('domain: one table of three sizes, never below the default; a step is held at the ends', () => {
  assert.equal(JSON.stringify(D.TEXT_SIZES), '{"default":1,"large":1.125,"larger":1.25}');
  assert.equal(D.TEXT_SIZE_STEPS.join(), 'default,large,larger');
  assert.equal(Object.isFrozen(D.TEXT_SIZES), true);
  for (const [size, factor] of [['default', 1], ['large', 1.125], ['larger', 1.25], ['huge', 1], [undefined, 1], [null, 1], [1.25, 1], ['toString', 1], ['__proto__', 1]]) assert.equal(D.textScale(size), factor, String(size));
  for (const value of Object.values(D.TEXT_SIZES)) assert.ok(value >= 1, 'nothing under the default (owner: nothing under 12px)');
  for (const [size, step, next] of [['default', 1, 'large'], ['large', 1, 'larger'], ['larger', 1, 'larger'], ['larger', -1, 'large'], ['large', -1, 'default'], ['default', -1, 'default'], ['bogus', 1, 'large'], ['large', 0, 'large']]) assert.equal(D.textSizeStep(size, step), next, `${size} ${step}`);
});

test('domain: a widget\'s smallest card grows with the widget text size, never past the size a new card opens at', () => {
  for (const type of ['tasks', 'calendar', 'note']) {
    const base = D.WIDGET_MIN[type], open = D.WIDGET_OPEN[type];
    assert.equal(JSON.stringify(D.widgetMinimum(type, 'default')), JSON.stringify(base), `${type}: 기본 is WIDGET_MIN`);
    for (const size of ['large', 'larger']) {
      const m = D.widgetMinimum(type, size);
      assert.ok(m.minWidth >= base.minWidth && m.minHeight >= base.minHeight, `${type} ${size}: never smaller than WIDGET_MIN`);
      assert.ok(m.minWidth <= open.width && m.minHeight <= open.height, `${type} ${size}: never past the open size`);
    }
  }
  assert.equal(JSON.stringify(D.widgetMinimum('tasks', 'larger')), '{"minWidth":350,"minHeight":300}', 'the 280×240 to-do card had no whole row at 더 크게');
  assert.equal(JSON.stringify(D.widgetMinimum('calendar', 'larger')), '{"minWidth":360,"minHeight":440}', 'capped at the 360×440 a calendar opens at');
  assert.equal(JSON.stringify(D.widgetMinimum('bogus', 'large')), JSON.stringify(D.widgetMinimum('note', 'large')), 'note sizes as the fallback');
  assert.equal(main.includes("const size = { ...(WIDGET_OPEN[widget.type] || WIDGET_OPEN.note) };"), true, 'main opens a widget at the same table');
});

test('store: both default to 기본, are healed when a file holds anything else, and reach the windows', t => {
  assert.equal(initialState().settings.textSize, 'default');
  assert.equal(initialState().settings.widgetTextSize, 'default');
  for (const [value, want] of [['large', 'large'], ['larger', 'larger'], ['huge', 'default'], [1.25, 'default'], [null, 'default'], ['toString', 'default'], ['', 'default']]) {
    const state = initialState(); state.settings.textSize = value; state.settings.widgetTextSize = value;
    const healed = validateState(state).settings;
    assert.equal(healed.textSize, want, `textSize ${String(value)}`);
    assert.equal(healed.widgetTextSize, want, `widgetTextSize ${String(value)}`);
  }
  const old = initialState(); delete old.settings.textSize; delete old.settings.widgetTextSize;
  assert.equal(validateState(old).settings.textSize, 'default', 'a file from before 1.2.7');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'dayboard-r60-X-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const store = createStore(directory);
  store.mutate(state => { state.settings.textSize = 'larger'; state.settings.widgetTextSize = 'large'; });
  const shown = store.publicState().settings;
  assert.equal(shown.textSize, 'larger');
  assert.equal(shown.widgetTextSize, 'large');
});

// main.cjs's real settings:update case in a VM over a real store; what it calls besides is recorded.
function settingsCommand(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'dayboard-r60-X-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const store = createStore(directory);
  const applied = [];
  const context = { store, tr: i18n.tr, TEXT_SIZES: D.TEXT_SIZES, commit: fn => store.mutate(fn), applyTextSize: () => applied.push('main'), applyWidgetMinimums: () => applied.push('widgets'), applyLanguage() {}, updater: null, Object };
  vm.createContext(context);
  const from = main.indexOf("    case 'settings:update': {"), to = main.indexOf("    case 'account:connect': {", from);
  assert.ok(from > 0 && to > from, 'main.cjs still has the settings:update case');
  const command = vm.runInContext(`(async function command(commandName, payload) { switch (commandName) { ${main.slice(from, to)} } })`, context, { filename: 'main.cjs' });
  return { store, applied, update: payload => command('settings:update', payload) };
}

test('settings:update takes 기본 / 크게 / 더 크게 for each and refuses anything else; the main window zooms, the widgets\' minimum follows', async t => {
  const { store, applied, update } = settingsCommand(t);
  await update({ textSize: 'larger' });
  assert.equal(store.get().settings.textSize, 'larger');
  assert.equal(applied.join(), 'main', 'the main window takes the new zoom at once');
  await update({ widgetTextSize: 'large' });
  assert.equal(store.get().settings.widgetTextSize, 'large');
  assert.equal(applied.join(), 'main,widgets', 'the widget cards get their minimum (their content follows the broadcast)');
  await update({ theme: 'dark' });
  assert.equal(applied.length, 2, 'another setting leaves the zoom alone');
  for (const bad of [{ textSize: 'huge' }, { textSize: 1.25 }, { textSize: 'toString' }, { widgetTextSize: '' }, { widgetTextSize: null }]) {
    const message = await update(bad).then(() => 'accepted', error => error.message);
    assert.equal(message, '지원하지 않는 글자 크기입니다.', JSON.stringify(bad));
  }
  assert.equal(store.get().settings.textSize, 'larger', 'a refused value changes nothing');
  assert.equal(store.get().settings.widgetTextSize, 'large');
});

test('main: the main window is zoomed from its first paint, after every load and on Ctrl+wheel; a widget page never', () => {
  assert.match(main, /new BrowserWindow\(\{ \.\.\.commonWindow\(\{ zoomFactor: textScale\(store\?\.get\(\)\.settings\.textSize\) \}\)/, 'the first paint has the zoom');
  assert.match(main, /mainWindow\.webContents\.on\('did-finish-load', \(\) => applyTextSize\(zoomed\)\);/);
  assert.match(main, /mainWindow\.webContents\.on\('zoom-changed', \(\) => applyTextSize\(zoomed\)\);/, 'Ctrl+wheel puts the setting back');
  assert.match(main, /if \(Math\.abs\(win\.webContents\.getZoomFactor\(\) - 1\) > 1e-6\) win\.webContents\.setZoomFactor\(1\);/, 'a widget page is reset to 1 on every load');
  const fn = main.slice(main.indexOf('function applyTextSize('), main.indexOf('\n}\n', main.indexOf('function applyTextSize(')));
  assert.equal(fn.includes('widgetWindows'), false, 'applyTextSize touches the main window only');
  assert.equal((main.match(/setZoomFactor\(/g) || []).length, 2, 'two zoom calls: the main window\'s setting and a widget\'s reset to 1');
});

test('the keys: Ctrl+= / Ctrl++ / Ctrl+numpad + larger, Ctrl+- smaller, Ctrl+0 the default — main window only, swallowed in a widget', async () => {
  const run = async ({ isWidget = false, size = 'default', init }) => {
    let listener = null;
    const h = harness({ isWidget, window: { addEventListener(type, fn, capture) { if (type === 'keydown' && capture === true) listener = fn; }, removeEventListener() {} } });
    h.context.state.settings.textSize = size;
    h.loadApp('const textSizeOf=', 'const textSizeLabel=', 'function syncTextSizeSelects(', "window.addEventListener('keydown',e=>{if(!e.ctrlKey||e.altKey||e.metaKey)return;const dir=");
    assert.equal(typeof listener, 'function', 'a capture listener on the window, ahead of the drop-down guard');
    let prevented = false;
    listener({ ctrlKey: true, altKey: false, metaKey: false, repeat: false, isComposing: false, target: h.document.body, preventDefault() { prevented = true; }, ...init });
    await h.tick();
    const call = h.calls.find(c => c.name === 'settings:update');
    return { prevented, to: call ? call.payload.textSize : null, calls: h.calls.length };
  };
  for (const [init, size, to] of [[{ key: '=', code: 'Equal' }, 'default', 'large'], [{ key: '+', code: 'Equal' }, 'large', 'larger'], [{ key: '+', code: 'NumpadAdd' }, 'default', 'large'],
    [{ key: '-', code: 'Minus' }, 'larger', 'large'], [{ key: '-', code: 'NumpadSubtract' }, 'large', 'default'], [{ key: '0', code: 'Digit0' }, 'larger', 'default'], [{ key: '0', code: 'Numpad0' }, 'large', 'default']]) {
    const got = await run({ size, init });
    assert.equal(got.prevented, true, `${init.code}: Chromium's own zoom never gets it`);
    assert.equal(got.to, to, `${init.code} from ${size}`);
  }
  for (const [init, size] of [[{ key: '=', code: 'Equal' }, 'larger'], [{ key: '-', code: 'Minus' }, 'default'], [{ key: '0', code: 'Digit0' }, 'default']]) {
    const got = await run({ size, init });
    assert.equal(got.prevented, true);
    assert.equal(got.calls, 0, `${init.code} at ${size}: nothing to change, nothing saved, no toast`);
  }
  const widget = await run({ isWidget: true, init: { key: '-', code: 'Minus' } });
  assert.equal(widget.prevented, true, 'a widget swallows the key (its wallpaper slice would slide under a zoomed page)');
  assert.equal(widget.calls, 0, 'and changes no setting');
  const composing = await run({ init: { key: '=', code: 'Equal', isComposing: true } });
  assert.equal(composing.calls, 0, 'not in the middle of a Korean syllable');
  const other = await run({ init: { key: 'k', code: 'KeyK' } });
  assert.equal(other.prevented, false, 'other Ctrl keys pass');
  const alt = await run({ init: { key: '=', code: 'Equal', altKey: true } });
  assert.equal(alt.prevented, false, 'AltGr (Ctrl+Alt) types characters on some layouts');
  const line = appLine("window.addEventListener('keydown',e=>{if(!e.ctrlKey||e.altKey||e.metaKey)return;const dir=");
  assert.ok(line.includes("run('settings:update',{textSize:next},tr('글자 크기: {0}',[textSizeLabel(next)]))"), 'saved like the select, one toast line');
  assert.ok(app.indexOf(line) < app.indexOf("window.addEventListener('keydown',e=>{const menu=e.target?.closest?.('select');if(menu&&menu!==e.target)e.stopImmediatePropagation();},true);"), 'registered before the guard that stops keys inside an open drop-down');
});

test('the ? card lists the three keys under 어디서나, in Korean and English', () => {
  const h = harness();
  h.load(read('renderer/help.js'), 'renderer/help.js');
  const groups = h.eval('shortcutGroups')();
  const anywhere = groups.find(([title]) => title === '어디서나')[1];
  const rows = anywhere.slice(-1).map(([label, combos]) => `${label}=${combos.map(c => c.join('+')).join('/')}`);
  assert.equal(rows.join(' | '), '글자 크기=Ctrl++/Ctrl+-/Ctrl+0');
  for (const [label] of anywhere.slice(-1)) assert.ok(I.EN[label], `${label} has English`);
});

test('the two selects: 글자 크기 in the sheet\'s first group and as the 위젯 tab card\'s third row, 기본 · 크게 · 더 크게', () => {
  const h = harness();
  h.context.state.settings.widgetTextSize = 'larger';
  h.loadApp('const textSizeOf=', 'const textSizeLabel=', 'function textSizeSelect(');
  const pick = h.eval("textSizeSelect('widgetTextSize',tr('위젯 글자 크기'))");
  assert.equal(pick.tagName, 'SELECT');
  assert.equal(pick.getAttribute('aria-label'), '위젯 글자 크기');
  assert.equal(pick.getAttribute('data-text-size'), 'widgetTextSize');
  assert.equal(pick.hasAttribute('data-instant'), true, 'saved as it changes: no discard question');
  assert.equal(pick.className, 'form-input', 'the neighbours\' select');
  assert.equal([...pick.querySelectorAll('option')].map(o => `${o.value}:${o.textContent}`).join(), 'default:기본,large:크게,larger:더 크게');
  const sheet = appLine('function openSettings(');
  assert.ok(sheet.includes("field(tr('시간 표시'),clock),field(tr('글자 크기'),size)),"), 'the first group: 언어 · 화면 모드 · 시간 표시 · 글자 크기 (달력에 할 일 went to the second on 2026-11-11)');
  const tab = appLine('function widgetsView(');
  assert.ok(tab.includes("glassControl(),h('div',{class:'appearance-row'},h('span',{},tr('글자 크기')),textSizeSelect('widgetTextSize',tr('위젯 글자 크기'))))"), 'the third 44px row of the appearance card');
  assert.ok(tab.includes("'--wz':String(D.textScale(state.settings.widgetTextSize))"), 'the gallery previews take the widgets\' factor');
  for (const key of ['글자 크기', '크게', '더 크게', '위젯 글자 크기', '글자 크기: {0}', '지원하지 않는 글자 크기입니다.']) assert.ok(I.EN[key], `${key} has English`);
  assert.equal(I.EN['글자 크기'], 'Text size');
  assert.equal(`${I.EN['기본']}/${I.EN['크게']}/${I.EN['더 크게']}`, 'Default/Large/Larger');
});

test('CSS: the widget card\'s content zooms, the card, its wallpaper and its grip do not; r60-X sits right before r60-E, which stays last', () => {
  const x = css.indexOf('/* r60-X text size'), e = css.indexOf('/* r60-E (keep last)');
  assert.ok(x > 0 && e > x, 'r60-X before r60-E');
  assert.equal(css.slice(e).includes('/* r60-'), true);
  assert.equal(css.slice(e + 5).includes('/* r60-'), false, 'no r60 block after r60-E');
  assert.ok(css.includes('.widget-body .widget-surface>:not(.widget-resize-handle){zoom:var(--wz,1)}'), 'the children of the card, not the card');
  assert.ok(css.includes('.widget-gallery .widget-preview>*{zoom:var(--wz,1)}'), 'the preview cards\' content');
  assert.equal(/(#backdrop|\.widget-surface|\.widget-preview|\.widget-edges)\s*\{[^}]*zoom/.test(css), false, 'no zoom on the wallpaper, the card or the edge bands');
  assert.equal(main.includes('widgetWindows.get(') && /widget[^\n]*setZoomFactor\(factor\)/.test(main), false, 'no widget window is zoomed by Chromium');
  assert.ok(app.includes("document.body.style.setProperty('--wz',String(D.textScale(state.settings.widgetTextSize)));"), 'the widget page sets its factor');
  assert.ok(app.includes('parseFloat(getComputedStyle(content).paddingBottom)*D.textScale(state.settings.widgetTextSize)'), 'the agenda fit counts the zoomed padding (computed styles are unzoomed)');
  assert.ok(glass.includes("if (gallery) { if (typeof fitWidgetPreviews === 'function') fitWidgetPreviews(gallery); glassPreviews(gallery, glassLevel()); }"), 'the preview cards keep their size before the lens is cut');
});

test('a zoomed narrow window (720 CSS px at 더 크게): the calendar bar compacts below 860, the title falls back to the month alone', () => {
  assert.ok(css.includes('@media(max-width:860px){.topbar .event-add-button .button-label{display:none}'), '일정 추가 keeps its 32px button');
  assert.ok(css.includes("html:not(:lang(ko)) .view-switch-item::after{content:attr(data-short);font-size:12px}"), 'English D/W/M');
  assert.ok(css.includes('@media(min-width:651px) and (max-width:860px){:root{--gutter:16px}.sidebar{width:200px}'), 'the 650 and 450 rules keep their own values');
  assert.ok(css.includes('.topbar-main h1 .title-text.tiny::after{content:attr(data-tiny);display:inline}'));
  assert.ok(css.includes('.calendar-grid.rolling .day-tasks,.calendar-grid.rolling .day-more{max-width:100%;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}'), 'one line each, as the line budget counts');
  const h = harness({ eventsBetween: () => [], goToday() {}, addEvent() {}, dayDots: () => [], shortTitle: x => x, calendarMenu() {}, eventColor: () => '#3478f6', isLocalEvent: () => true, canEditEvent: () => true, writableCalendars: () => [] });
  h.context.view = 'calendar';
  h.loadApp('const longDateFormats=', 'const koreanDate=', 'function byEventOrder(', 'function monthGrid(', 'const timeFormat=', 'function fmtTime(', 'const isRecurring=', 'function timeLabel(');
  h.loadCalendar();
  const year = new Date().getFullYear();
  h.context.state.settings.calendarView = 'month'; h.context.month = new Date(year, 10, 1);
  assert.equal(h.eval('calendarTitleTiny')(), '11월', 'this year: the month alone');
  h.context.month = new Date(year + 1, 10, 1);
  assert.equal(h.eval('calendarTitleTiny')(), `${String(year + 1).slice(2)}년 11월`, 'another year keeps two digits');
  h.context.state.settings.calendarView = 'week'; h.context.selectedDate = `${year}-12-01`;
  const mid = D.fromDate(D.weekDays(`${year}-12-01`)[3]);
  assert.equal(h.eval('calendarTitleTiny')(), `${mid.getMonth() + 1}월`, 'a week by its middle day');
  h.context.state.settings.calendarView = 'day'; h.context.selectedDate = `${year}-03-04`;
  assert.equal(h.eval('calendarTitleTiny')(), '3월', 'a day by its month (its column header shows the day)');
  I.setLanguage('en');
  try { h.context.state.settings.calendarView = 'month'; h.context.month = new Date(year, 10, 1); assert.equal(h.eval('calendarTitleTiny')(), 'Nov'); } finally { I.setLanguage('ko'); }
});

// CONTRACT.md is the private agreement, not part of the public source (scripts/export-public-source.cjs): skipped there, as
// tests/release.test.cjs does for CHANGELOG.md (2026-11-02 r60 integration).
test('CONTRACT.md documents both keys', { skip: !fs.existsSync(path.join(__dirname, '..', 'CONTRACT.md')) && 'CONTRACT.md is private (not in the public source)' }, () => {
  const contract = read('CONTRACT.md');
  assert.ok(contract.includes("textSize 'default'|'large'|'larger'"));
  assert.ok(contract.includes("widgetTextSize 'default'|'large'|'larger'"));
});
