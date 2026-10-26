'use strict';
// Where new tasks and events go, 2026-10-27 review (round 25): the automatic list and calendar follow the order accounts were
// connected in, not their place in state.lists/calendars (a sync that re-read one account moved its calendars last, and the
// next new event went to the other account); Outlook's flagged-mail list is never a target (it only gathers flagged mail,
// its archive copy after a disconnect is an ordinary list); a disconnect clears a chosen list of that account as it already
// cleared a chosen calendar.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const D = require('../renderer/domain.js');
const { createStore } = require('../lib/store.cjs');
const { createSync } = require('../lib/sync.cjs');

const accounts = [{ id: 'acc-g', provider: 'google' }, { id: 'acc-m', provider: 'microsoft' }];
const calendar = (id, provider, accountId, extra = {}) => ({ id, provider, accountId, readOnly: false, ...extra });

test('the automatic calendar is the first connected account\'s primary calendar, wherever a sync put it in the list', () => {
  const google = calendar('g-primary', 'google', 'acc-g', { primary: true });
  const microsoft = calendar('m-primary', 'microsoft', 'acc-m', { primary: true });
  const local = { id: 'local-calendar', provider: 'local' };
  const base = { accounts, settings: { defaultCalendarId: null } };
  assert.equal(D.defaultCalendarId({ ...base, calendars: [local, google, microsoft] }), 'g-primary');
  // After a change in Google, its resync appends Google's calendars at the end: the target stays Google.
  assert.equal(D.defaultCalendarId({ ...base, calendars: [local, microsoft, google] }), 'g-primary');
  // An account without a writable primary calendar gives way to the next one that has one, as before.
  assert.equal(D.defaultCalendarId({ ...base, calendars: [local, calendar('g-other', 'google', 'acc-g'), microsoft] }), 'm-primary');
  // With no primary anywhere, the first account's first writable calendar.
  assert.equal(D.defaultCalendarId({ ...base, calendars: [local, calendar('m-x', 'microsoft', 'acc-m'), calendar('g-x', 'google', 'acc-g')] }), 'g-x');
  assert.equal(D.defaultCalendarId({ ...base, calendars: [local] }), 'local-calendar');
});

test('the automatic list is the first Microsoft account\'s To Do 「Tasks」, else this PC, never the flagged-mail list', () => {
  const work = [{ id: 'acc-w', provider: 'microsoft' }, { id: 'acc-p', provider: 'microsoft' }];
  const lists = [
    { id: 'p-flag', provider: 'microsoft', accountId: 'acc-p', kind: 'flaggedEmails' },
    { id: 'p-tasks', provider: 'microsoft', accountId: 'acc-p', kind: 'defaultList' },
    { id: 'w-tasks', provider: 'microsoft', accountId: 'acc-w', kind: 'defaultList' },
    { id: 'local-inbox', provider: 'local' },
  ];
  assert.equal(D.autoListId(lists, work), 'w-tasks', 'the account connected first, not the first in the list');
  assert.equal(D.autoListId(lists, [...work].reverse()), 'p-tasks');
  assert.equal(D.autoListId(lists.filter(l => l.kind !== 'defaultList'), work), 'local-inbox');
  // 「Tasks」 and 「이 PC」 hidden: the flagged-mail list is first, but a task cannot go there.
  assert.equal(D.autoListId([lists[0], { id: 'g-list', provider: 'google', accountId: 'acc-g' }], work), 'g-list');
  assert.equal(D.autoListId([lists[0]], work), null, 'nothing that can hold a task: main then uses 「내 할 일」');
  assert.equal(D.taskList(lists[0]), false);
  assert.equal(D.taskList({ id: 'archive', provider: 'local', kind: 'flaggedEmails' }), true, 'the archive copy after a disconnect is an ordinary list');
  assert.equal(D.accountCount([...lists, { id: 'g', provider: 'google', accountId: 'acc-g' }]), 3);
  assert.equal(D.accountCount([{ id: 'local-inbox', provider: 'local' }]), 0);
});

test('disconnecting an account clears a default list chosen from it, as it clears a default calendar', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'dayboard-defaults-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const store = createStore(directory); const credentials = {};
  const vault = { get: id => credentials[id], set: (id, value) => { credentials[id] = value; }, remove: id => { delete credentials[id]; } };
  const sync = createSync({ store, userData: directory, dependencies: { vault, auth: { authorize: async () => ({}), refresh: async value => value, dispose() {} }, providers: {} } });
  t.after(() => sync.dispose());
  vault.set('acc-m', { provider: 'microsoft', accessToken: 'a', refreshToken: 'r', expiresAt: Date.now() + 3600000 });
  store.mutate(state => {
    state.accounts.push({ id: 'acc-m', provider: 'microsoft', name: 'Mock', status: 'connected' });
    state.lists.push({ id: 'm-tasks', provider: 'microsoft', accountId: 'acc-m', remoteId: 't', kind: 'defaultList', name: 'Tasks' });
    state.calendars.push({ id: 'm-cal', provider: 'microsoft', accountId: 'acc-m', remoteId: 'c', name: '일정', readOnly: false });
    state.settings.defaultListId = 'm-tasks'; state.settings.defaultCalendarId = 'm-cal';
  });
  await sync.disconnect('acc-m');
  const { settings } = store.get();
  assert.equal(settings.defaultListId, null);
  assert.equal(settings.defaultCalendarId, null);
});
