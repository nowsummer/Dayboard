'use strict';
// A list left out of 전체 (2026-11-07 owner): gone from 전체 and its count, still in its own list, 오늘 and a search; the menu turns it on and off.
const test = require('node:test');
const assert = require('node:assert/strict');
const { harness } = require('./r50-F-harness.cjs');

const today = require('../renderer/domain.js').dateKey();
const setup = () => {
  const h = harness({ lingering: new Set(), flagHold: new Map(), taskSortOf: () => 'due' });
  h.loadApp('const inAll=', 'function tasksFor(');
  Object.assign(h.context.state, { settings: { notInAll: ['work'] }, lists: [{ id: 'home', name: '집' }, { id: 'work', name: '회사' }],
    tasks: [{ id: 'a', title: '우유', listId: 'home' }, { id: 'b', title: '보고서', listId: 'work', dueDate: today }] });
  return h;
};
const ids = (h, v) => h.eval('tasksFor')(v, false, false).map(t => t.id).join();

test('전체 leaves the list out; the list itself, 오늘 and a search still show its tasks', () => {
  const h = setup();
  assert.equal(ids(h, 'all'), 'a');
  assert.equal(ids(h, 'work'), 'b');
  assert.equal(ids(h, 'today'), 'b');
  h.context.search = '보고';
  h.load('search="보고"');
  assert.equal(ids(h, 'all'), 'b');
});

test('with nothing left out 전체 is everything', () => {
  const h = setup();
  h.context.state.settings.notInAll = [];
  assert.equal(ids(h, 'all'), 'a,b');
  delete h.context.state.settings.notInAll;
  assert.equal(ids(h, 'all'), 'a,b');
});
