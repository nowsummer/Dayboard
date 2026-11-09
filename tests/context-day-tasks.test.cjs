'use strict';
// The right panel's list of a day's tasks (2026-11-07): left out only when the screen beside it shows those very tasks.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const line = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'app.js'), 'utf8').split(/\r?\n/).find(text => text.startsWith('function contextDayTasks('));
function panel({ view, search = '', selectedDate = '2026-11-07' }) {
  const context = { view, search, selectedDate, state: { tasks: [] }, D: { dateKey: () => '2026-11-07', stepsDueOn: () => [] }, dayTasksOf: () => [{ id: 't1' }],
    taskRow: () => 'row', stepDayRow: () => 'step', h: (tag, props, ...kids) => ({ tag, props, kids }), tr: text => text, btn: () => null, goto() {} };
  vm.runInNewContext(`${line}\nresult = contextDayTasks(5);`, context);
  return context.result;
}

test('오늘 beside the panel lists today\'s tasks, so the panel does not', () => {
  assert.equal(panel({ view: 'today' }), null);
});

test('a search in 오늘 shows its results instead, so the panel keeps the day (Codex 2026-11-07 recheck U2)', () => {
  assert.ok(panel({ view: 'today', search: '치과' }));
});

test('another day, or another screen, keeps the list', () => {
  assert.ok(panel({ view: 'today', selectedDate: '2026-11-08' }));
  assert.ok(panel({ view: 'all' }));
});
