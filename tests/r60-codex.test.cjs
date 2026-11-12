'use strict';
// 2026-11-03 Codex review of the 1.2.7 candidate (gpt-6.1-sol, two runs): the four findings and how they were settled.
// F1 partly accepted (no application menu), F2 accepted and widened (a 24-hour H:MM must fit its period word), I1 accepted
// (the preview fitter's hidden rows really hide), I2 accepted with one shared save() (the widget settings link waits for it).
// Primitives only in the assertions (no DOM nodes or VM objects — see tests/r60-*.test.cjs and the 2026-11-02 memory incident).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const R = require('../renderer/domain.js');

const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
const pad = n => String(n).padStart(2, '0');
const local = iso => { if (!iso) return ''; const d = new Date(iso); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const now = new Date('2026-10-20T10:00:00');
const ko = text => { const r = R.parseQuickKo(text, '2026-10-20', now); return [r.title, r.dueDate, local(r.reminderAt)]; };
const en = text => { const r = R.parseQuickEn(text, '2026-10-20', now); return [r.title, r.dueDate, local(r.reminderAt)]; };

test('F2: a 24-hour time that clashes with its period word stays a word; one that fits is read', () => {
  for (const text of ['밤 15:30 회의', '밤 17:00 회의', '저녁 14:00 회의', '낮 19:00 산책']) assert.deepEqual(ko(text), [text, '', ''], text);
  for (const text of ['tonight at 15:30 call', 'this evening 14:00 call', 'this afternoon at 19:00 call']) assert.deepEqual(en(text), [text, '', ''], text);
  assert.deepEqual(ko('밤 18:30 회식'), ['회식', '2026-10-20', '2026-10-20 18:30']);
  assert.deepEqual(ko('밤 21:30 약'), ['약', '2026-10-20', '2026-10-20 21:30']);
  assert.deepEqual(ko('저녁 17:30 회식'), ['회식', '2026-10-20', '2026-10-20 17:30']);
  assert.deepEqual(ko('낮 13:00 점심'), ['점심', '2026-10-20', '2026-10-20 13:00']);
  assert.deepEqual(ko('내일 오후 14:00 회의'), ['회의', '2026-10-21', '2026-10-21 14:00']);
  assert.deepEqual(ko('밤 0:30 백업'), ['백업', '2026-10-21', '2026-10-21 00:30']);
  assert.deepEqual(en('tonight at 21:00 meds'), ['meds', '2026-10-20', '2026-10-20 21:00']);
  assert.deepEqual(en('this evening 18:30 dinner'), ['dinner', '2026-10-20', '2026-10-20 18:30']);
  assert.deepEqual(en('this afternoon at 15:30 call'), ['call', '2026-10-20', '2026-10-20 15:30']);
  assert.deepEqual(en('tonight at 0:30 backup'), ['backup', '2026-10-21', '2026-10-21 00:30']);
});

test('F1: the app removes Electron\'s default application menu before it opens any window', () => {
  const main = read('main.cjs');
  const ready = main.indexOf('app.whenReady().then(');
  const menu = main.indexOf('Menu.setApplicationMenu(null)', ready);
  assert.ok(ready > 0 && menu > ready, 'setApplicationMenu(null) runs inside whenReady');
  const firstWindow = main.indexOf('createMainWindow(', menu) >= 0 ? main.indexOf('createMainWindow(', menu) : main.indexOf('new BrowserWindow', menu);
  assert.ok(menu < firstWindow || firstWindow < 0, 'before the first window of the ready handler');
});

test('I1: rows the widget preview fitter hides get display:none (author display:flex outranks [hidden])', () => {
  const css = read('renderer/styles.css').replace(/\/\*[\s\S]*?\*\//g, '');
  assert.match(css, /\.widget-gallery \.widget-preview \[data-fit-hidden\]\{display:none\}/);
  const app = read('renderer/app.js');
  assert.ok(app.includes("setAttribute('data-fit-hidden','')"), 'the fitter still marks the rows it hides');
});

test('I2: 적용 and 「위젯 모양 설정…」 share one save(); the link opens the widgets tab only after it succeeded', () => {
  const app = read('renderer/app.js');
  const start = app.indexOf('function openWidgetSettings(');
  const end = app.indexOf('\nfunction ', start + 10);
  const fn = app.slice(start, end);
  assert.equal(fn.split('const save=async()=>{').length - 1, 1, 'one save()');
  // The 위치와 크기 고정 row saves itself the moment it is ticked (2026-11-11 owner, tests/widget-home-1111.test.cjs); all else goes through save().
  const rest = fn.replace(/const lock=h\('input',\{[^]*?\}\}\);/, '');
  assert.ok(rest.length < fn.length, 'the lock row is found');
  assert.equal(rest.split("run('widget:update'").length - 1, 1, 'widget:update is written in one place');
  assert.ok(fn.includes('try{await save();closeModal();}catch{release();}'), '적용 uses save()');
  const link = fn.slice(fn.indexOf("btn(tr('위젯 모양 설정…'),async e=>{"));
  const saved = link.indexOf('await save();');
  const open = link.indexOf("api.invoke('window:main',{view:'widgets'})");
  assert.ok(saved > 0 && open > saved, 'save is awaited before the main window opens');
  assert.ok(link.slice(saved, open).includes('return;'), 'a failed save returns before opening the main window');
});
