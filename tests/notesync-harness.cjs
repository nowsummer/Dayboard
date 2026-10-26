'use strict';
// Shared by tests/notesync*.test.cjs (not a test file itself): an in-memory Google Drive appDataFolder that speaks the parts
// of Drive v3 Dayboard uses — list with appProperties and paging, multipart create, alt=media download, delete; an update
// (PATCH) is refused, because notes sync never overwrites a file; `lagging` hides files from listings the way Drive's
// files.list can trail a create — and simulated PCs, each a real store with a Google
// account that holds the notes.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createStore } = require('../lib/store.cjs');
const { createNotesSync, recordNoteDeletion, laterThan, archiveText, copyOf, noteKey, noteRev, sameContent } = require('../lib/notesync.cjs');

const ACCOUNT = 'google-account-1';
function temporary(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'dayboard-notesync-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return directory;
}
const failure = (status, reason) => Object.assign(new Error(`HTTP ${status}`), { status, ...(reason ? { reason } : {}) });
// Edits on every simulated PC follow one clock, as real edits follow real time (an edit never repeats an earlier instant).
let wall = Date.parse('2026-10-21T00:00:00.000Z');
const tick = () => new Date(wall += 1000).toISOString();
// Time passing for every simulated PC (earlier versions keep a text that stayed unchanged for 10 minutes).
const elapse = ms => { wall += ms; };

// hooks.before(method, url, options, who) runs before a request is answered (a test can act "in the middle" of a run;
// `who` is the PC asking); hooks.created(file, who) sees each new file; hooks.after(...) runs once Drive has done the
// request and can still make the PC see a failure (a timeout whose upload went through); hooks.fail(method, url, options, who) returns a status, { status, reason } or 'net' to make that request fail.
function fakeDrive({ pageSize = 1000, clock = () => Date.now() } = {}) {
  const files = new Map(); let next = 1; const calls = []; const hooks = {}; const lagging = new Set();
  const multipart = (headers, body) => {
    const boundary = /boundary=([^;]+)/.exec(headers['Content-Type'])[1];
    const parts = body.split(`--${boundary}`).slice(1, -1).map(part => part.replace(/^\r\n/, '').split('\r\n\r\n').slice(1).join('\r\n\r\n').replace(/\r\n$/, ''));
    return { metadata: JSON.parse(parts[0]), content: parts[1] };
  };
  async function request(url, options = {}, who = null) {
    const u = new URL(url); const method = options.method || 'GET';
    calls.push(`${method} ${u.pathname}`);
    if (hooks.before) await hooks.before(method, u, options, who);
    if (hooks.fail) {
      const result = hooks.fail(method, u, options, who);
      if (result === 'net') throw new Error('network down');
      if (result) throw typeof result === 'object' ? failure(result.status, result.reason) : failure(result);
    }
    const answer = respond(u, method, options, who);
    if (hooks.after) {
      const outcome = hooks.after(method, u, options, who);
      if (outcome === 'net') throw new Error('network down');
      if (outcome) throw failure(outcome);
    }
    return answer;
  }
  function respond(u, method, options, who) {
    if (u.pathname === '/drive/v3/files' && method === 'GET') {
      assert.equal(u.searchParams.get('spaces'), 'appDataFolder');
      assert.equal(u.searchParams.get('q'), null, 'the whole app folder is listed (it holds only Dayboard files)');
      const all = [...files.values()].filter(f => !lagging.has(f.id));
      const start = Number(u.searchParams.get('pageToken') || 0);
      const page = all.slice(start, start + pageSize).map(f => ({ id: f.id, modifiedTime: f.modifiedTime, appProperties: { ...f.appProperties } }));
      return { files: page, ...(start + pageSize < all.length ? { nextPageToken: String(start + pageSize) } : {}) };
    }
    const id = decodeURIComponent(u.pathname.split('/').pop());
    if (u.pathname.startsWith('/drive/v3/files/') && method === 'GET') {
      if (!files.has(id)) throw failure(404);
      if (u.searchParams.get('fields') === 'id') return { id };
      assert.equal(u.searchParams.get('alt'), 'media');
      return JSON.parse(files.get(id).content);
    }
    if (u.pathname === '/upload/drive/v3/files' && method === 'POST') {
      assert.equal(u.searchParams.get('uploadType'), 'multipart');
      const { metadata, content } = multipart(options.headers, options.body);
      assert.deepEqual(metadata.parents, ['appDataFolder']);
      for (const [key, value] of Object.entries(metadata.appProperties)) {
        assert.equal(typeof value, 'string', 'Drive properties are strings');
        assert.ok(Buffer.byteLength(key + value) <= 124, 'Drive allows 124 bytes per property (key and value)');
      }
      const file = { id: `f${next++}`, name: metadata.name, appProperties: { ...metadata.appProperties }, content, modifiedTime: new Date(clock()).toISOString() };
      files.set(file.id, file);
      if (hooks.created) hooks.created(file, who);
      return { id: file.id };
    }
    if (u.pathname.startsWith('/drive/v3/files/') && method === 'DELETE') {
      if (!files.has(id)) throw failure(404);
      files.delete(id); return null;
    }
    throw new Error(`unexpected ${method} ${u.href}`);
  }
  const noteFiles = noteId => [...files.values()].filter(f => f.appProperties.dayboard === 'note' && f.appProperties.noteId === noteId);
  const texts = () => [...files.values()].filter(f => f.appProperties.dayboard === 'note').map(f => JSON.parse(f.content)).filter(c => !c.deleted).map(c => c.body);
  return { files, calls, hooks, lagging, request, noteFiles, texts };
}

// One PC. save/create/remove do what main.cjs note:save / note:delete do to the store (a save is always later than the
// version it replaces). `offset` puts this PC's clock ahead (+) or behind (-) of the others, in ms.
function pc(t, drive, { name = 'PC', access = true, now, onNotesRemoved, offset = 0 } = {}) {
  const time = () => new Date(Date.parse(tick()) + offset).toISOString();
  const store = createStore(temporary(t));
  store.mutate(state => {
    state.accounts.push({ id: ACCOUNT, provider: 'google', name: 'me@example.com', status: 'connected', notesAccess: access });
    state.settings.notesAccountId = ACCOUNT; state.settings.notesAutoDone = true;
  });
  const removed = [];
  const self = { name, store, removed, beforeApply: null };
  self.notes = createNotesSync({
    store, change: fn => store.mutate(fn), requestFor: () => (url, options) => drive.request(url, options, self), hasAccess: () => access, delay: 0,
    onNotesRemoved: onNotesRemoved || (info => removed.push(info)),
    beforeApply: async () => { if (self.beforeApply) await self.beforeApply(); },
    // The sync engine reads the same clock as this PC's saves (as main.cjs and lib/notesync.cjs both read the real clock).
    now: now || (() => new Date(wall + offset)),
  });
  t.after(() => self.notes.dispose());
  Object.assign(self, {
    // As main.cjs note:save. `base`: the version an editor's draft started from (a note object as the renderer had it);
    // when the stored note is another version with another text, that text is kept as a copy.
    save(id, fields, base = null) {
      const stamp = time();
      store.mutate(state => {
        const previous = state.notes.find(n => n.id === id);
        if (!previous && !fields.create) throw new Error('항목이 없거나 이미 삭제되었습니다.');
        const updatedAt = fields.updatedAt || (previous ? laterThan(stamp, previous.updatedAt) : stamp);
        const note = { id, title: fields.title ?? previous?.title ?? '메모', body: fields.body ?? previous?.body ?? '', color: fields.color ?? previous?.color ?? 'yellow', updatedAt, editedAt: stamp };
        note.past = previous ? archiveText(previous.past, previous, stamp, { next: note }) : []; // as main.cjs note:save (and a save restores)
        if (previous?.pinned) note.pinned = true; // as main.cjs: a pin stays through typing
        if (previous?.pinnedAt) note.pinnedAt = previous.pinnedAt;
        if (previous && sameContent(previous, note)) note.textKey = previous.textKey || noteKey(previous);
        if (previous && sameContent(previous, note)) { if (previous.storedAt) note.storedAt = previous.storedAt; } else note.storedAt = stamp;
        const moved = Boolean(previous && base) && (previous.updatedAt !== base.updatedAt || noteRev(previous) !== noteRev(base));
        const sameText = Boolean(previous && base) && (previous.textKey || noteKey(previous)) === (base.textKey || noteKey(base)); // as main.cjs: by text identity (textId)
        const copy = moved && !sameText && !sameContent(previous, note) ? copyOf(previous, previous.id, previous.textKey || noteKey(previous), previous.updatedAt) : null;
        if (previous) state.notes = state.notes.map(item => item.id === id ? note : item); else state.notes.push(note);
        if (copy && !state.notes.some(item => item.id === copy.id)) state.notes.push(copy);
      });
    },
    create(id, fields = {}) { self.save(id, { ...fields, create: true }); },
    // As main.cjs note:trash / note:restore: 「최근 삭제한 메모」 is an edit that sets or clears trashedAt.
    trash(id) {
      const stamp = time();
      store.mutate(state => {
        state.notes = state.notes.map(n => (n.id === id && !n.trashedAt ? { ...n, trashedAt: stamp, trashSeenAt: stamp, updatedAt: laterThan(stamp, n.updatedAt), textKey: n.textKey || noteKey(n) } : n));
        state.widgets = state.widgets.filter(w => w.noteId !== id);
      });
    },
    restore(id) {
      const stamp = time();
      store.mutate(state => {
        state.notes = state.notes.map(n => { if (n.id !== id || !n.trashedAt) return n; const next = { ...n, updatedAt: laterThan(stamp, n.updatedAt), textKey: n.textKey || noteKey(n) }; delete next.trashedAt; delete next.trashSeenAt; return next; });
      });
    },
    // As main.cjs note:pin: a pin is a new version with the same text.
    pin(id, pinned = true) {
      const stamp = time();
      store.mutate(state => { state.notes = state.notes.map(n => { if (n.id !== id || Boolean(n.pinned) === pinned) return n; const next = { ...n, updatedAt: laterThan(stamp, n.updatedAt), textKey: n.textKey || noteKey(n), pinnedAt: laterThan(stamp, n.pinnedAt) }; if (pinned) next.pinned = true; else delete next.pinned; return next; }); });
    },
    remove(id) {
      store.mutate(state => {
        const gone = state.notes.find(n => n.id === id);
        state.notes = state.notes.filter(n => n.id !== id);
        state.widgets = state.widgets.filter(w => w.noteId !== id);
        recordNoteDeletion(state, gone, time());
      });
    },
    note: id => store.get().notes.find(n => n.id === id),
    titles: () => store.get().notes.map(n => n.title).sort(),
    bodies: () => store.get().notes.map(n => n.body).sort(),
    status: () => store.publicState().noteSync,
    meta: () => store.get().noteSync.accounts[ACCOUNT] || { files: {}, deleted: {} },
    sync: () => self.notes.sync().catch(error => ({ error })),
  });
  return self;
}
// Runs every PC in turn until a whole round writes nothing to Drive (or gives up after `rounds`).
async function settle(drive, sides, rounds = 8) {
  for (let round = 0, quiet = 0; round < rounds; round++) {
    const before = drive.calls.length;
    for (const side of sides) { const result = await side.sync(); if (result?.error) throw result.error; }
    quiet = drive.calls.slice(before).some(call => !call.startsWith('GET')) ? 0 : quiet + 1;
    if (quiet === 2) return true;
  }
  return false;
}
module.exports = { ACCOUNT, temporary, failure, tick, elapse, fakeDrive, pc, settle };
