'use strict';
// A finished task is not late (2026-11-14, found while reviewing red for overdue dates): its date and time, and a step's in a day list, turn
// red only while it is open — the rows a finished task keeps (shown with 「완료 N개」, the moment after the tick) read as done, not late.
// A step's own date (stepDate's `late`) already asked !x.completed. Source checks: the row builders need the whole app to run.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const app = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'app.js'), 'utf8');

test('a task row: its time, its date and a same-day reminder are red only while the task is open', () => {
  const row = app.slice(app.indexOf('function taskRow('), app.indexOf('function taskRow(') + 20000);
  // red: open and not under the 지난 할 일 head, which says late once (2026-11-14, tests/overdue-red-1114.test.cjs)
  assert.equal(row.includes('const red=!t.completed&&!headed;'), true, 'one flag for the row');
  assert.equal(row.includes("class:'due-time'+(red&&at.getTime()<Date.now()?' overdue':'')"), true, 'time');
  assert.equal(row.includes("{class:'due-date'+(red&&t.dueDate<D.dateKey()?' overdue':'')"), true, 'date (its own class since 2026-11-14: orange as the time)');
  assert.equal(row.includes("together&&red&&t.dueDate<D.dateKey()?' overdue':''"), true, 'reminder on its day');
});

test("a step in a day's list: its time is red only while the step is open", () => {
  const row = app.slice(app.indexOf('function stepDayRow('), app.indexOf('function stepDayRow(') + 6000);
  assert.equal(row.includes("class:'due-time'+(!x.completed&&at.getTime()<Date.now()?' overdue':'')"), true);
});

test('no row marks a time overdue without asking whether it is done', () => {
  assert.equal(app.includes("class:'due-time'+(at.getTime()<Date.now()?' overdue':'')"), false);
});
