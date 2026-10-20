'use strict';
// Deleting and hiding lists, and the widget glass strength (2026-10-20): built-in list rules, the visible state,
// provider delete calls, the sync wrapper's error handling and the stored settings.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const D = require('../renderer/domain.js');
const { createStore, initialState, validateState } = require('../lib/store.cjs');
const { createSync } = require('../lib/sync.cjs');
const microsoft = require('../lib/providers/microsoft.cjs');
const google = require('../lib/providers/google.cjs');

function temporary(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'dayboard-lists-'));
  t.after(() => {
    const resolved = path.resolve(directory);
    assert.equal(path.dirname(resolved), path.resolve(os.tmpdir()));
    assert.ok(path.basename(resolved).startsWith('dayboard-lists-'));
    fs.rmSync(resolved, { recursive: true, force: true });
  });
  return directory;
}
const cloud = { id: 'cloud-list', remoteId: 'list-1', accountId: 'account-1', provider: 'microsoft', name: '작업', kind: 'none' };

test('built-in lists are Microsoft Tasks / Flagged email, Google default and the local inbox', () => {
  assert.equal(D.builtInList({ id: 'm', provider: 'microsoft', kind: 'flaggedEmails' }), 'flaggedEmails');
  assert.equal(D.builtInList({ id: 'm', provider: 'microsoft', kind: 'defaultList' }), 'defaultList');
  assert.equal(D.builtInList({ id: 'g', provider: 'google', kind: 'defaultList' }), 'defaultList');
  assert.equal(D.builtInList({ id: 'local-inbox', provider: 'local' }), 'inbox');
  assert.equal(D.builtInList(cloud), '');
  assert.equal(D.builtInList({ id: 'x', provider: 'local' }), '');
  assert.equal(D.builtInList(null), '');
});

test('hidden lists leave every screen with their tasks, combine with hidden sections and never hide everything', () => {
  const state = {
    settings: { hiddenSections: [], hiddenLists: ['flag'] },
    lists: [{ id: 'local-inbox', provider: 'local' }, { id: 'flag', provider: 'microsoft', accountId: 'a', kind: 'flaggedEmails' }, { id: 'work', provider: 'microsoft', accountId: 'a' }],
    tasks: [{ id: 't1', listId: 'flag' }, { id: 't2', listId: 'work' }, { id: 't3', listId: 'local-inbox' }]
  };
  const shown = D.visibleState(state);
  assert.deepEqual(shown.lists.map(l => l.id), ['local-inbox', 'work']);
  assert.deepEqual(shown.tasks.map(t => t.id), ['t2', 't3']);
  assert.equal(shown.allLists.length, 3, 'the settings dialog still sees every list');
  const both = D.visibleState({ ...state, settings: { hiddenSections: ['local'], hiddenLists: ['flag'] } });
  assert.deepEqual(both.lists.map(l => l.id), ['work']);
  const all = D.visibleState({ ...state, settings: { hiddenSections: ['a'], hiddenLists: ['local-inbox'] } });
  assert.equal(all.lists.length, 3, 'hiding everything is ignored');
  assert.equal(D.visibleState({ ...state, settings: {} }).lists.length, 3);
});

test('glass level 0.5 is the previous adaptive tint; clearer levels tint less, tinted levels more', () => {
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  for (const L of [0.02, 0.15, 0.4, 0.7, 0.95]) {
    const g = D.glassTint(0.5, L);
    assert.equal(g.a, +clamp((0.93 - L) / Math.max(0.05, 1 - L), 0.42, 0.93).toFixed(3), `light tint at L=${L}`);
    assert.equal(g.da, +clamp(L > 0.17 ? (L - 0.17) / Math.max(0.05, L - 0.12) : 0.4, 0.4, 0.86).toFixed(3), `dark tint at L=${L}`);
    assert.equal(g.blur, 26); assert.equal(g.sat, 175); assert.equal(g.alpha, 0.94);
    let previous = null;
    for (const level of [0, 0.25, 0.5, 0.75, 1]) {
      const current = D.glassTint(level, L);
      if (previous) {
        assert.ok(current.a >= previous.a && current.da >= previous.da, `tint grows with the level at L=${L}`);
        assert.ok(current.blur >= previous.blur && current.alpha >= previous.alpha, 'blur and solid alpha grow with the level');
      }
      previous = current;
    }
  }
  // Clear glass on a dark wallpaper still leaves a light card for dark text (composite luminance about .73).
  const clear = D.glassTint(0, 0.05);
  assert.ok(clear.a * 1 + (1 - clear.a) * 0.05 > 0.7);
  assert.deepEqual(Object.keys(D.glassTint(0.5, null)).sort(), ['alpha', 'blur', 'sat'], 'no wallpaper: only blur and solid alpha');
  assert.equal(D.glassTint(Number.NaN, 0.5).blur, 26, 'an invalid level falls back to the default');
  assert.equal(D.glassTint(7, 0.5).alpha, 1);
});

test('settings keep hidden lists and the glass level; a changed old opacity carries over', t => {
  const directory = temporary(t);
  const store = createStore(directory);
  assert.deepEqual(store.publicState().settings.hiddenLists, []);
  assert.equal(store.publicState().settings.glassLevel, 0.5);
  store.mutate(state => { state.settings.hiddenLists = ['a']; state.settings.glassLevel = 0.2; });
  assert.deepEqual(createStore(directory).publicState().settings.hiddenLists, ['a']);
  assert.equal(createStore(directory).publicState().settings.glassLevel, 0.2);
  const old = initialState(); delete old.settings.glassLevel; delete old.settings.hiddenLists; old.settings.widgetOpacity = 0.86;
  assert.equal(validateState(structuredClone(old)).settings.glassLevel, 0.25);
  old.settings.widgetOpacity = 0.94;
  assert.equal(validateState(structuredClone(old)).settings.glassLevel, 0.5, 'the default opacity gives the default glass');
  // The migration inverts glassTint's always-on-top alpha over the whole old slider range (0.65–1).
  for (const [opacity, level] of [[1, 1], [0.97, 0.75], [0.9, 0.38], [0.65, 0]]) {
    old.settings.widgetOpacity = opacity;
    const migrated = validateState(structuredClone(old)).settings.glassLevel;
    assert.equal(migrated, level, 'opacity ' + opacity);
    if (opacity >= 0.78) assert.ok(Math.abs(D.glassTint(migrated, null).alpha - opacity) <= 0.005, 'the same always-on-top alpha comes back for ' + opacity);
  }
  for (const bad of [{ glassLevel: 2 }, { glassLevel: '0.5' }, { hiddenLists: 'x' }, { hiddenLists: [1] }]) {
    const broken = initialState(); Object.assign(broken.settings, bad);
    assert.throws(() => validateState(broken), /설정이 올바르지 않습니다/);
  }
});

test('providers delete a list with DELETE on the list itself', async () => {
  const sent = [];
  const ms = microsoft.createMicrosoft({ request: async (url, options) => { sent.push({ url, method: options.method }); return null; } });
  assert.equal((await ms.mutateList('delete', cloud)).id, cloud.id);
  assert.equal(sent[0].method, 'DELETE'); assert.ok(sent[0].url.endsWith('/me/todo/lists/list-1'));
  const gl = google.createGoogle({ request: async (url, options) => { sent.push({ url, method: options.method }); return null; } });
  await gl.mutateList('delete', { ...cloud, provider: 'google', remoteId: 'g/1' });
  assert.equal(sent[1].method, 'DELETE'); assert.equal(sent[1].url, 'https://tasks.googleapis.com/tasks/v1/users/@me/lists/g%2F1');
});

test('the Google snapshot marks the default task list; a failed lookup leaves lists unmarked', async () => {
  const answer = (failDefault) => async url => {
    const target = new URL(url);
    if (target.pathname === '/tasks/v1/users/@me/lists/@default') { if (failDefault) { const error = new Error('nope'); error.status = 404; throw error; } return { id: 'mine' }; }
    if (target.pathname === '/tasks/v1/users/@me/lists') return { items: [{ id: 'mine', title: '내 할 일 목록' }, { id: 'other', title: '여행' }] };
    if (target.pathname.endsWith('/tasks')) return { items: [] };
    if (target.pathname === '/calendar/v3/users/me/calendarList') return { items: [] };
    throw new Error('unexpected ' + url);
  };
  const marked = await google.createGoogle({ request: answer(false) }).snapshot('acc');
  assert.deepEqual(marked.lists.map(l => [l.remoteId, l.kind]), [['mine', 'defaultList'], ['other', 'none']]);
  const plain = await google.createGoogle({ request: answer(true) }).snapshot('acc');
  assert.deepEqual(plain.lists.map(l => l.kind), ['none', 'none']);
});

test('sync deletes cloud lists at the service: a list already gone counts as deleted, a refusal is explained', async t => {
  const directory = temporary(t); const store = createStore(directory); const credentials = {};
  const vault = { get: id => credentials[id], set: (id, value) => { credentials[id] = value; }, remove: id => { delete credentials[id]; } };
  const auth = { authorize: async () => ({}), refresh: async value => value, dispose() {} };
  let failWith = 0; const calls = [];
  const providers = { microsoft: () => ({ mutateList: async (kind, list) => { calls.push(kind); if (failWith) { const error = new Error('HTTP ' + failWith); error.status = failWith; throw error; } return list; } }) };
  const sync = createSync({ store, userData: directory, dependencies: { vault, auth, providers } });
  t.after(() => sync.dispose());
  vault.set(cloud.accountId, { provider: 'microsoft', accessToken: 'a', refreshToken: 'r', expiresAt: Date.now() + 3600000 });
  store.mutate(state => { state.accounts.push({ id: cloud.accountId, provider: 'microsoft', name: 'Mock', status: 'connected' }); state.lists.push(cloud); });
  assert.equal((await sync.mutateList('delete', cloud)).id, cloud.id);
  failWith = 404; assert.equal((await sync.mutateList('delete', cloud)).id, cloud.id, 'already deleted at the service');
  failWith = 403;
  await assert.rejects(sync.mutateList('delete', cloud), error => /삭제하지 못했어요/.test(error.message) && /HTTP 403/.test(error.message) && error.status === 403);
  assert.equal(store.get().accounts[0].status, 'connected', 'a refused delete does not mark the account as failing');
  failWith = 500;
  await assert.rejects(sync.mutateList('delete', cloud), /HTTP 500/);
  assert.equal(store.get().accounts[0].status, 'error', 'a server failure is shown on the account like other writes');
  assert.equal((await sync.mutateList('delete', { id: 'l', provider: 'local' })).id, 'l', 'local lists pass straight through');
  await assert.rejects(sync.mutateList('archive', cloud), /지원하지 않는 목록 변경/);
  assert.deepEqual(calls, ['delete', 'delete', 'delete', 'delete']);
});

test('disconnecting keeps a hidden list hidden as its archive copy', async t => {
  const directory = temporary(t); const store = createStore(directory); const credentials = {};
  const vault = { get: id => credentials[id], set: (id, value) => { credentials[id] = value; }, remove: id => { delete credentials[id]; } };
  const sync = createSync({ store, userData: directory, dependencies: { vault, auth: { authorize: async () => ({}), refresh: async value => value, dispose() {} }, providers: {} } });
  t.after(() => sync.dispose());
  vault.set(cloud.accountId, { provider: 'microsoft', accessToken: 'a', refreshToken: 'r', expiresAt: Date.now() + 3600000 });
  store.mutate(state => { state.accounts.push({ id: cloud.accountId, provider: 'microsoft', name: 'Mock', status: 'connected' }); state.lists.push(cloud, { ...cloud, id: 'flag', remoteId: 'f', kind: 'flaggedEmails', name: 'Flagged Emails' }); state.settings.hiddenLists = ['flag']; });
  await sync.disconnect(cloud.accountId);
  const state = store.get();
  const archive = state.lists.find(list => list.name.startsWith('Flagged Emails'));
  assert.ok(archive && archive.provider === 'local' && archive.id !== 'flag');
  assert.ok(state.settings.hiddenLists.includes(archive.id) && state.settings.hiddenLists.includes('flag'), 'archive id added, cloud id kept for a reconnect');
  assert.ok(!D.visibleState(state).lists.some(list => list.id === archive.id));
  assert.equal(D.builtInList(archive), '', 'an archive copy is an ordinary local list and can be deleted');
});

test('when every list ends up hidden, only 「내 할 일」 (or the first list) comes back and other choices stay', () => {
  const lists = [{ id: 'w', provider: 'microsoft', accountId: 'ms' }, { id: 'local-inbox', provider: 'local' }, { id: 'flag', provider: 'microsoft', accountId: 'ms' }];
  const state = { lists, settings: { hiddenSections: ['local', 'g'], hiddenLists: ['w', 'flag', 'gone'] } };
  assert.equal(D.keepOneVisible(state), true);
  assert.deepEqual(state.settings.hiddenSections, ['g'], 'only the inbox section is shown again');
  assert.deepEqual(state.settings.hiddenLists, ['w', 'flag', 'gone'], 'other hidden lists (and ids for later reconnects) stay hidden');
  assert.deepEqual(D.visibleState(state).lists.map(l => l.id), ['local-inbox']);
  assert.equal(D.keepOneVisible(state), false, 'nothing to do while a list is visible');
  const noInbox = { lists: [lists[0], lists[2]], settings: { hiddenSections: ['ms'], hiddenLists: ['flag'] } };
  assert.equal(D.keepOneVisible(noInbox), true);
  assert.deepEqual([noInbox.settings.hiddenSections, noInbox.settings.hiddenLists], [[], ['flag']], 'the first list is shown, Flagged Emails stays hidden');
});

test('disconnecting while 「이 PC」 is hidden shows 「이 PC」 again but keeps the hidden archive hidden', async t => {
  const directory = temporary(t); const store = createStore(directory); const credentials = {};
  const vault = { get: id => credentials[id], set: (id, value) => { credentials[id] = value; }, remove: id => { delete credentials[id]; } };
  const sync = createSync({ store, userData: directory, dependencies: { vault, auth: { authorize: async () => ({}), refresh: async value => value, dispose() {} }, providers: {} } });
  t.after(() => sync.dispose());
  vault.set(cloud.accountId, { provider: 'microsoft', accessToken: 'a', refreshToken: 'r', expiresAt: Date.now() + 3600000 });
  store.mutate(state => { state.accounts.push({ id: cloud.accountId, provider: 'microsoft', name: 'Mock', status: 'connected' }); state.lists.push(cloud, { ...cloud, id: 'flag', remoteId: 'f', kind: 'flaggedEmails', name: 'Flagged Emails' }); state.settings.hiddenSections = ['local']; state.settings.hiddenLists = ['flag']; });
  await sync.disconnect(cloud.accountId);
  const state = store.get();
  assert.deepEqual(state.settings.hiddenSections, []);
  const shown = D.visibleState(state).lists.map(list => list.name);
  assert.ok(shown.some(name => name.startsWith('작업')) && !shown.some(name => name.startsWith('Flagged Emails')), JSON.stringify(shown));
});

test('the hiding guard refuses only a save that newly hides the last visible list', () => {
  const lists = [{ id: 'a', provider: 'microsoft', accountId: 's1' }, { id: 'b', provider: 'google', accountId: 's2' }];
  // Every list already hidden (a delete or a sync did it): re-sending the same settings goes through.
  assert.equal(D.hidingRefusal({ hiddenSections: ['s2'], hiddenLists: ['a'] }, { hiddenSections: ['s2'], hiddenLists: ['a'] }, lists), '');
  // A hidden by list, then the section holding the only other list: refused as an account hide.
  assert.equal(D.hidingRefusal({ hiddenSections: [], hiddenLists: ['a'] }, { hiddenSections: ['s2'], hiddenLists: ['a'] }, lists), 'sections');
  // Newly hiding the last visible list itself: refused as a list hide.
  assert.equal(D.hidingRefusal({ hiddenSections: ['s2'], hiddenLists: [] }, { hiddenSections: ['s2'], hiddenLists: ['a'] }, lists), 'lists');
  // Hiding something while another list stays visible is fine; so is showing things again.
  assert.equal(D.hidingRefusal({}, { hiddenLists: ['a'] }, lists), '');
  assert.equal(D.hidingRefusal({ hiddenLists: ['a', 'b'] }, { hiddenLists: ['b'] }, lists), '');
  assert.equal(D.hidingRefusal({}, { hiddenLists: ['a'] }, []), '', 'no lists at all: nothing to protect');
});
