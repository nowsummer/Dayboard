'use strict';
// 2026-11-09 review B (F9): a task reminder's Windows notification says the due day and time as the screen does (renderer/app.js
// fmtTime + dueLabelRaw): 오늘/내일, the 12/24-hour setting, the language — not the stored '2026-11-09 15:00'. main.cjs checkReminders
// runs as it is (cut out into a VM with a real store and a fake Notification).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const D = require('../renderer/domain.js');
const A = require('../lib/alerts.cjs');
const I = require('../lib/i18n.cjs');
const { createStore } = require('../lib/store.cjs');

const source = fs.readFileSync(path.join(__dirname, '..', 'main.cjs'), 'utf8').replace(/\r\n/g, '\n');
const piece = name => { const at = source.indexOf(`\nfunction ${name}(`); assert.ok(at >= 0, name); return source.slice(at + 1, source.indexOf('\n}\n', at) + 2); };

function reminderBodies(t, { timeFormat = '12h', language = 'ko', dueDate, dueTime }) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'dayboard-due-'));
  t.after(() => { fs.rmSync(directory, { recursive: true, force: true }); I.setLanguage('ko'); });
  I.setLanguage(language);
  const store = createStore(directory);
  const now = new Date();
  store.mutate(state => {
    state.settings.timeFormat = timeFormat;
    state.tasks.push({ id: 't1', listId: state.lists[0].id, title: '보고서', notes: '', completed: false, important: false, createdAt: now.toISOString(), updatedAt: now.toISOString(), dueDate, ...(dueTime ? { dueTime } : {}), reminderAt: new Date(now.getTime() - 60000).toISOString() });
  });
  const bodies = [];
  class Notification { static isSupported() { return true; } constructor(options) { bodies.push(options.body); } on() {} show() {} }
  const context = { store, quitting: false, commit: fn => store.mutate(fn), Notification, path, __dirname: '.', showMain() {}, tr: I.tr, console, Date, Set, ...D, ...A };
  vm.createContext(context);
  vm.runInContext(piece('checkReminders') + '\ncheckReminders();', context, { filename: 'main.cjs' });
  return bodies.map(body => body.split(' · ').slice(1).join(' · '));
}
const today = () => D.dateKey(new Date());

test('F9: today 15:00 reads 「마감 오늘 오후 3:00」, or 15:00 with 24 hours, and in English as the English screen', t => {
  assert.equal(reminderBodies(t, { dueDate: today(), dueTime: '15:00' }).join('|'), '마감 오늘 오후 3:00');
  assert.equal(reminderBodies(t, { dueDate: today(), dueTime: '15:00', timeFormat: '24h' }).join('|'), '마감 오늘 15:00');
  assert.equal(reminderBodies(t, { dueDate: today(), dueTime: '09:05', language: 'en' }).join('|'), 'Due Today 9:05 AM');
});

test('F9: a date only reads the day as the task row does (내일, or the month and day)', t => {
  assert.equal(reminderBodies(t, { dueDate: D.dayOffset(today(), 1) }).join('|'), '마감 내일');
  const later = D.dayOffset(today(), 20);
  const shown = new Date(`${later}T12:00:00`).toLocaleDateString('ko-KR', { month: 'long', day: 'numeric', ...(Number(later.slice(0, 4)) !== new Date().getFullYear() ? { year: 'numeric' } : {}) });
  assert.equal(reminderBodies(t, { dueDate: later }).join('|'), `마감 ${shown}`);
});

test('F9: lib/alerts.cjs clockText writes every time as renderer/app.js fmtTime does (12/24 hours, Korean and English)', t => {
  t.after(() => I.setLanguage('ko'));
  const app = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'app.js'), 'utf8').split(/\r?\n/).find(line => line.startsWith('function fmtTime('));
  assert.ok(app, 'app.js still has fmtTime');
  const results = [];
  for (const language of ['ko', 'en']) for (const timeFormat of ['12h', '24h']) {
    I.setLanguage(language);
    const fmtTime = vm.runInNewContext(`${app}; fmtTime`, { timeFormat: () => timeFormat, I: { lang: () => language }, tr: I.tr, String, Number, Date });
    for (const [h, m] of [[0, 0], [9, 5], [11, 59], [12, 0], [15, 30], [23, 1]]) {
      const at = new Date(2026, 10, 9, h, m);
      results.push(fmtTime(at) === A.clockText(at, { timeFormat }) ? 'same' : `${language} ${timeFormat} ${fmtTime(at)} ≠ ${A.clockText(at, { timeFormat })}`);
    }
  }
  assert.equal(results.filter(item => item !== 'same').join('; '), '');
});
