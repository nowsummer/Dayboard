'use strict';
// 2026-11-14 merge recheck (offline, B1/C1): the wfold merge put widget-fold, date-ink and widget-task-drag between sidebar-lists and
// account-error in the whole smoke; ui-smoke.cjs's note was moved on, account-error's own head still said "after sidebar-lists". A smoke
// helper's "after X" tells the next person which state it starts from, so every such note naming another helper must name the helper the
// whole smoke really runs just before it. Notes naming a check instead (calendar-month-fit, tooltip-innermost) are not read here.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const smokeSource = fs.readFileSync(path.join(__dirname, 'ui-smoke.cjs'), 'utf8');
const helperName = file => file.replace(/^ui-smoke-/, '').replace(/-\d+[a-z]?\.cjs$/, '');

// The whole run's order: every helper ui-smoke.cjs calls outside the DAYBOARD_SMOKE_ONLY returns (helper functions such as chosenAtFoot
// are not calls of a block).
const wholeOrder = (() => {
  const order = [];
  for (const line of smokeSource.split('\n')) {
    if (line.includes('DAYBOARD_SMOKE_ONLY')) continue;
    const call = line.match(/require\('\.\/(ui-smoke-[a-z-]+-\d+[a-z]?\.cjs)'\)\(\{/);
    if (call) order.push(helperName(call[1]));
  }
  return order;
})();

const before = name => {
  const at = wholeOrder.indexOf(name);
  assert.notEqual(at, -1, `${name} runs in the whole smoke`);
  assert.equal(wholeOrder.lastIndexOf(name), at, `${name} runs once in the whole smoke`);
  return wholeOrder[at - 1];
};

test('the whole smoke order is read from ui-smoke.cjs', () => {
  assert.deepEqual(wholeOrder.slice(wholeOrder.indexOf('spacing'), wholeOrder.indexOf('offline-events') + 1),
    ['spacing', 'sidebar-lists', 'widget-fold', 'date-ink', 'widget-task-drag', 'account-error', 'offline', 'offline-events']);
});

test('a smoke helper whose head says "Called by tests/ui-smoke.cjs after X" runs right after X in the whole smoke', () => {
  const read = [];
  for (const file of fs.readdirSync(__dirname).filter(name => /^ui-smoke-[a-z-]+-\d+[a-z]?\.cjs$/.test(name))) {
    const claim = fs.readFileSync(path.join(__dirname, file), 'utf8').match(/Called by tests\/ui-smoke\.cjs (?:right )?after ([a-z-]+)/);
    if (!claim || !wholeOrder.includes(claim[1])) continue;
    const name = helperName(file);
    assert.equal(before(name), claim[1], `${file}: its head says after ${claim[1]}, the whole smoke runs ${before(name)} just before it`);
    read.push(name);
  }
  assert.equal(read.includes('account-error'), true, 'account-error\'s head is read');
  assert.equal(read.length >= 5, true, `heads read: ${read.join(' ')}`);
});

test('ui-smoke.cjs: a DAYBOARD_SMOKE_ONLY note "the whole smoke runs it after X" matches the whole run', () => {
  const read = [];
  for (const [, name, claimed] of smokeSource.matchAll(/DAYBOARD_SMOKE_ONLY=([a-z-]+); the whole smoke runs it (?:right )?after ([a-z-]+)/g)) {
    if (!wholeOrder.includes(claimed)) continue;
    assert.equal(before(name), claimed, `ui-smoke.cjs says ${name} runs after ${claimed}, the whole smoke runs ${before(name)} just before it`);
    read.push(name);
  }
  assert.equal(read.includes('account-error'), true, 'account-error\'s note is read');
  assert.equal(read.length >= 5, true, `notes read: ${read.join(' ')}`);
});
