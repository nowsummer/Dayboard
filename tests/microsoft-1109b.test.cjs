'use strict';
// 2026-11-09 review F18·F64 (Microsoft). This file reads the PC's zone as New York: a UTC all-day event must keep its date west of UTC.
process.env.TZ = 'America/New_York';
const test = require('node:test');
const assert = require('node:assert/strict');
const microsoft = require('../lib/providers/microsoft.cjs');

test('F18: an all-day event kept in UTC shows on its own date on a PC west of UTC, without asking for it again', async () => {
  assert.equal(require('../lib/providers/common.cjs').LOCAL_ZONE, 'America/New_York');
  for (const zone of ['UTC', 'tzone://Microsoft/Utc']) {
    let details = 0;
    const provider = microsoft.createMicrosoft({ request: async url => {
      if (url.includes('/todo/lists')) return { value: [] };
      if (url.includes('/calendarView?')) return { value: [{ id: 'e', subject: '종일', isAllDay: true, originalStartTimeZone: zone, start: { dateTime: '2026-11-09T00:00:00.0000000', timeZone: 'UTC' }, end: { dateTime: '2026-11-10T00:00:00.0000000', timeZone: 'UTC' } }] };
      if (url.includes('/events/')) { details++; return {}; }
      return { value: [{ id: 'c', name: '달력' }] };
    } });
    const { events } = await provider.snapshot('a');
    assert.equal(`${events[0].start}|${events[0].end}|${details}`, '2026-11-09|2026-11-10|0', zone);
  }
});

test('F64: a turned-off half of the account is not asked for', async () => {
  for (const [scope, unwanted] of [[{ tasks: false, calendar: true }, '/me/todo'], [{ tasks: true, calendar: false }, '/me/calendars']]) {
    const urls = [];
    const provider = microsoft.createMicrosoft({ request: async url => { urls.push(url); return { value: [] }; } });
    const result = await provider.snapshot('a', scope);
    assert.equal(urls.filter(url => url.includes(unwanted)).length, 0, unwanted);
    assert.equal(urls.length, 1);
    assert.equal(JSON.stringify([result.lists, result.tasks, result.calendars, result.events]), '[[],[],[],[]]');
  }
  const urls = [];
  await microsoft.createMicrosoft({ request: async url => { urls.push(url); return { value: [] }; } }).snapshot('a');
  assert.equal(urls.length, 2, 'without a scope both halves are read, as before');
});
