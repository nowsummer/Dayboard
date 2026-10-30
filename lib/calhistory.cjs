'use strict';
// The older tier of connected calendars (2026-10-30 owner: 「달력 5년 기록 「2단 방식」」 — agreed 2026-10-28, when widening the one sync
// window to five years made every edit two to three times slower: each save writes the whole state and sends it to every window).
// The recent window (renderer/domain.js syncWindow, a year back to a year ahead) stays in the saved state, synced every five minutes.
// The years before it, back to five years from today (historyWindow), live here: one file per account in userData\calendar-history,
// fetched once a day in pieces of twelve months, never in the saved state or a broadcast. The screen asks for a range when it shows
// an old month (calendar:history) and for matches when it searches (calendar:history-search); what it gets is read-only there.
// A piece that cannot be fetched keeps what the last file had for it, so a bad connection never empties the past.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { historyWindow, historyChunks } = require('../renderer/domain.js');

const DAY = 86400000;
const RETRY = 60 * 60000; // after a refresh that did not get every piece
const MAX_RANGE_DAYS = 400; // the screen asks for months at a time
const MAX_HITS = 500;
const PROVIDERS = new Set(['google', 'microsoft', 'icloud']);

// The instant an event starts and ends (all-day ones in this PC's days, as the screen counts them).
const startMs = event => event.allDay ? Date.parse(`${String(event.start).slice(0, 10)}T00:00:00`) : Date.parse(event.start);
function endMs(event) {
  if (!event.allDay) return Date.parse(event.end || event.start);
  const end = String(event.end || '').slice(0, 10);
  if (end) return Date.parse(`${end}T00:00:00`);
  const next = new Date(`${String(event.start).slice(0, 10)}T00:00:00`); next.setDate(next.getDate() + 1); return next.getTime();
}
const overlaps = (event, from, to) => { const a = startMs(event), b = endMs(event); return Number.isFinite(a) && a < to && (b > a ? b : a + 1) > from; };
const escape = text => String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const dayStart = key => Date.parse(`${key}T00:00:00`);
const isDayKey = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(dayStart(value));

// The record kept in the state (internal, lib/store.cjs checks its shape): per account, when the file was last written (at), when a
// refresh was last tried (tried) and whether it got every piece (ok). The screen sees the newest `at` and `rev` (historyStatus).
function validHistory(value) {
  const out = {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) return out;
  for (const [id, item] of Object.entries(value)) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    if (!['at', 'tried'].every(key => item[key] === undefined || (typeof item[key] === 'string' && Number.isFinite(Date.parse(item[key]))))) continue;
    out[id] = { ...(item.at ? { at: item.at } : {}), ...(item.tried ? { tried: item.tried } : {}), ok: item.ok === true };
  }
  return out;
}
// What the screen sees of it: the newest time (whether there is any), and `rev`, which changes whenever any account's copy does — one
// written, or one dropped (a disconnect, its calendars switched off) whichever account's copy was the newest. The screen keys what it
// asked for on `rev` (2026-10-30 Codex review R03: keyed on the newest time alone, a disconnected account's events stayed on screen
// while another account's copy was newer).
const historyStatus = state => {
  const kept = Object.entries(state.calendarHistory || {}).filter(([, item]) => item?.at).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return { at: kept.map(([, item]) => item.at).sort().at(-1) || null, rev: kept.map(([id, item]) => `${id}@${item.at}`).join(' ') };
};

// fetchEvents(accountId, calendarId, {start, end}) → the events of one calendar in that range, or null when the service has no way to
// read them (lib/sync.cjs historyEvents). onChange: after a refresh wrote a file (main broadcasts, so open views ask again).
function createCalendarHistory({ userData, store, fetchEvents, onChange = () => {}, now = () => new Date() }) {
  const folder = path.join(userData, 'calendar-history');
  const fileOf = accountId => path.join(folder, `${crypto.createHash('sha256').update(String(accountId)).digest('hex').slice(0, 24)}.json`);
  const cache = new Map(); // accountId → { at, window, events } as on disk
  // accountId → how many times its history was dropped: a refresh begun before a drop writes nothing (2026-10-30 Codex review R04 —
  // the answer to a piece still out at a disconnect wrote the file and the record again; an account connected again under the same
  // id is told apart by this, not by whether the id is there).
  const drops = new Map();
  let running = null; let again = false; let disposed = false;

  function load(accountId) {
    if (cache.has(accountId)) return cache.get(accountId);
    let data = null;
    try {
      const read = JSON.parse(fs.readFileSync(fileOf(accountId), 'utf8'));
      if (read && read.v === 1 && read.accountId === accountId && Array.isArray(read.events)) data = { at: read.at, window: read.window, events: read.events.filter(event => event && typeof event.id === 'string' && typeof event.calendarId === 'string' && typeof event.start === 'string') };
    } catch { /* none yet, or unreadable: fetched again */ }
    cache.set(accountId, data);
    return data;
  }
  function write(accountId, data) {
    fs.mkdirSync(folder, { recursive: true });
    const file = fileOf(accountId); const temp = `${file}.${crypto.randomUUID()}.tmp`;
    try { fs.writeFileSync(temp, JSON.stringify({ v: 1, accountId, ...data }), { encoding: 'utf8', mode: 0o600 }); fs.renameSync(temp, file); }
    finally { try { fs.rmSync(temp, { force: true }); } catch { /* already moved */ } }
    cache.set(accountId, data);
  }
  const note = (accountId, fields) => store.mutate(state => { state.calendarHistory = { ...(state.calendarHistory || {}), [accountId]: { ...(state.calendarHistory?.[accountId] || {}), ...fields } }; });
  // The accounts whose calendars come to Dayboard.
  const accountsOf = state => state.accounts.filter(account => PROVIDERS.has(account.provider) && account.syncCalendar !== false).map(account => account.id);

  // One account's years before the recent window, piece by piece, calendar by calendar (one request at a time: it runs in the
  // background beside the user's edits). Returns false when the service cannot read them. Before each piece, and right before it
  // writes, it checks it is still wanted — not dropped since, the account still bringing its calendars, Dayboard still running — and
  // stops there otherwise, writing nothing (R04).
  async function refresh(accountId) {
    const begun = drops.get(accountId) || 0;
    const wanted = () => !disposed && (drops.get(accountId) || 0) === begun && store.read(state => accountsOf(state).includes(accountId));
    const window = historyWindow(now()); const chunks = historyChunks(window);
    const calendars = store.read(state => state.calendars.filter(calendar => calendar.accountId === accountId).map(calendar => calendar.id));
    // The last file, for the pieces that fail; read only for this (kept in memory afterwards only when the screen already uses it).
    const used = Boolean(cache.get(accountId));
    const old = load(accountId);
    const events = new Map(); let failed = 0; let fetched = 0;
    for (const calendarId of calendars) {
      for (const chunk of chunks) {
        if (!wanted()) return true;
        const from = Date.parse(chunk.start), to = Date.parse(chunk.end);
        try {
          const got = await fetchEvents(accountId, calendarId, chunk);
          if (got === null) return false;
          fetched++;
          for (const event of got) if (event?.id && event.calendarId === calendarId) events.set(event.id, event);
        } catch {
          // Kept as it was: the piece is asked again within the hour.
          failed++;
          for (const event of old?.events || []) if (event.calendarId === calendarId && overlaps(event, from, to) && !events.has(event.id)) events.set(event.id, event);
        }
      }
    }
    const at = now().toISOString();
    if (!wanted()) return true;
    // A calendar deleted at its service (or by a sync) meanwhile: its events do not go into the file.
    const still = store.read(state => new Set(state.calendars.filter(calendar => calendar.accountId === accountId).map(calendar => calendar.id)));
    for (const [id, event] of events) if (!still.has(event.calendarId)) events.delete(id);
    // Nothing reached the service and nothing was kept: no file yet (an empty one would look like an empty past).
    if (!fetched && !old) { cache.delete(accountId); note(accountId, { tried: at, ok: false }); return true; }
    write(accountId, { at, window, events: [...events.values()].sort((a, b) => startMs(a) - startMs(b)) });
    if (!used) cache.delete(accountId);
    note(accountId, { at, tried: at, ok: failed === 0 });
    onChange();
    return true;
  }

  return {
    // After each round of the accounts (main.cjs): the accounts whose history is a day old, or whose last refresh missed a piece an
    // hour ago, one after another. A call while one runs waits for it, and the round runs once more after it — an account connected
    // meanwhile (also one connected again under the same id, whose old fetch wrote nothing) gets its history now, not at the next round.
    refreshDue() {
      if (running) { again = true; return running; }
      running = (async () => {
        do {
          again = false;
          const state = store.read(current => ({ ids: accountsOf(current), meta: current.calendarHistory || {} }));
          const time = now().getTime();
          for (const id of state.ids) {
            if (disposed) break;
            const meta = state.meta[id];
            const due = !meta || !meta.tried || (meta.ok ? time - Date.parse(meta.at || meta.tried) >= DAY : time - Date.parse(meta.tried) >= RETRY) || !fs.existsSync(fileOf(id));
            if (!due) continue;
            try { await refresh(id); } catch (error) { console.error('calendar history refresh failed:', error.message); }
          }
        } while (again && !disposed);
      })().finally(() => { running = null; });
      return running;
    },
    refresh,
    // The events between two days (YYYY-MM-DD, the end not included) that the recent window does not hold: of calendars still there,
    // of accounts still syncing calendars, coloured as their series is on this PC; marked `history` (read-only on the screen).
    query(from, to) {
      if (!isDayKey(from) || !isDayKey(to)) throw new Error('calendar history range');
      let a = dayStart(from), b = dayStart(to);
      if (b <= a) return [];
      if (b - a > MAX_RANGE_DAYS * DAY) b = a + MAX_RANGE_DAYS * DAY;
      const scope = store.read(state => ({ ids: accountsOf(state), calendars: new Set(state.calendars.map(calendar => calendar.id)), recent: new Set(state.events.map(event => event.id)), colours: { ...(state.seriesColors || {}) } }));
      const out = [];
      for (const id of scope.ids) {
        for (const event of load(id)?.events || []) {
          if (!scope.calendars.has(event.calendarId) || scope.recent.has(event.id) || !overlaps(event, a, b)) continue;
          out.push(shown(event, scope.colours));
        }
      }
      return out;
    },
    // Events whose title or place holds the words (ignoring case, as the screen's search does), newest first, at most 500.
    search(text) {
      const words = String(text || '').trim().slice(0, 200);
      if (!words) return { events: [], total: 0 };
      const pattern = new RegExp(escape(words), 'iu');
      const scope = store.read(state => ({ ids: accountsOf(state), calendars: new Set(state.calendars.map(calendar => calendar.id)), recent: new Set(state.events.map(event => event.id)), colours: { ...(state.seriesColors || {}) } }));
      const hits = [];
      for (const id of scope.ids) for (const event of load(id)?.events || []) {
        if (!scope.calendars.has(event.calendarId) || scope.recent.has(event.id)) continue;
        if (pattern.test(`${event.title || ''}\n${event.location || ''}`)) hits.push(event);
      }
      hits.sort((x, y) => startMs(y) - startMs(x));
      return { events: hits.slice(0, MAX_HITS).map(event => shown(event, scope.colours)), total: hits.length };
    },
    // An account disconnected or its calendars turned off: its file goes (the events stay at the service), and a refresh of it still
    // under way writes nothing.
    drop(accountId) {
      drops.set(accountId, (drops.get(accountId) || 0) + 1);
      cache.delete(accountId);
      try { fs.rmSync(fileOf(accountId), { force: true }); } catch { /* next start */ }
      if (store.read(state => Boolean(state.calendarHistory?.[accountId]))) { store.mutate(state => { const next = { ...(state.calendarHistory || {}) }; delete next[accountId]; state.calendarHistory = next; }); onChange(); }
    },
    dispose() { disposed = true; },
  };
}
// An event as the screen gets it: read-only, in its series' colour on this PC (a single old occurrence has no colour of its own).
function shown(event, colours) {
  const colour = event.seriesId ? colours[`${event.calendarId}:${event.seriesId}`] : undefined;
  return { ...event, history: true, ...(colour ? { color: colour } : {}) };
}

module.exports = { createCalendarHistory, validHistory, historyStatus };
