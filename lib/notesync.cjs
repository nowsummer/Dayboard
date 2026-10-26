'use strict';
// Notes sync between the user's own PCs through the connected Google account's hidden Drive application data folder
// (scope drive.appdata; 2026-10-21 user decision: notes stay Dayboard-only, they are not Google Keep notes).
//
// Versions, never overwritten (2026-10-21 review: overwriting a file lost an edit another PC uploaded in between).
//   Every save of a note becomes a NEW file in appDataFolder. Its private appProperties say which note and which version
//   ({ dayboard:'note', noteId, updatedAt, rev, prev?, deleted? }); its content carries the text, `history` (the keys it
//   replaces, newest first, at most FILE_HISTORY) and `ancestors` (the revs of everything it replaces, at most ANCESTORS,
//   so a PC switched off during a long writing day still finds its version replaced). Both are inherited from the versions
//   it replaces. A file is deleted only when it is proven replaced: a later version names it, or its text has been kept as
//   a copy note. So two PCs saving at the same moment leave two versions ("heads"), and the next run keeps both texts.
// Keys (lib/notekey.cjs): `<updatedAt>~<rev>`, rev a hash of the content and time — two different texts never share one.
//   Keys sort by time; a version is always later than the versions it was built on (laterThan) and only ever claims to
//   replace smaller keys, so "replaced" links can never form a circle, whatever the PCs' clocks say. The time shown to the
//   user is `editedAt` (the saving PC's own clock), so one PC's clock years ahead does not date every later edit.
// Local bookkeeping (internal): state.noteSync.accounts[accountId] = { files: {noteId: {fileId, base, history, text}},
//   deleted: {noteId: {fileId, base, history, deletedAt, seen, seenText}}, sent: {noteId: [keys]} }. `base` is the key this
//   PC last agreed with, `text` the version that brought that version's text (its textKey — kept apart from the 20-key
//   history, so a text pinned and unpinned many times is still known as this PC's), `seen` the key of the version the user
//   deleted and `seenText` its text, `sent` the keys this PC uploaded before it knew the result (a reply lost on the way
//   back still counts as this PC's lineage — 2026-10-21 reviews).
// Rules (never lose text): a note leaves a PC only for a deletion version that replaces what this PC has; a missing file
//   is uploaded again; an edit beats a deletion; texts that diverged all survive (newest stays the note, the others become
//   「<title> (2)」 copies, saved on the PC that resolves the conflict before anything is replaced); an edit typed during
//   a run is never overwritten (`expect`, beforeApply, and main's note:save keeps the stored text when a draft started
//   from another version — compared by rev).
// Trash and earlier versions travel with the note (2026-10-21 user decision 「휴지통·이전 버전」): `trashedAt` puts a note in
//   「최근 삭제한 메모」 (an edit like any other; main.cjs deletes it for good 30 days after this PC first saw it there,
//   `trashSeenAt`, local only), and `past` keeps up to PAST earlier texts (archiveText decides when), merged when another
//   PC's version replaces this one. Neither changes which texts are "the same" (sameContent: title, body, colour).
const crypto = require('node:crypto');
const { tr } = require('./i18n.cjs');
const { assertOrigin } = require('./providers/common.cjs');
const { notesAccountId } = require('./store.cjs');
const { noteKey, noteRev, pastKey, deletionKey, laterThan } = require('./notekey.cjs');

const DRIVE = 'https://www.googleapis.com/drive/v3/files';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files';
const HISTORY = 20;          // kept here, per note
const FILE_HISTORY = 500;    // keys kept in each Drive file (about 20 KB)
const ANCESTORS = 4000;      // revs kept in each Drive file (about 76 KB)
const TOMBSTONE_DAYS = 90;
const PAST = 10;             // earlier texts kept per note
const PAST_CHARS = 200000;   // and at most this much text in them
const SETTLED = 10 * 60000;  // a text left unchanged this long is kept when it is changed
const SESSION = 30 * 60000;  // during long editing, one earlier text every half hour
const RETRY = 60000;         // a run that failed for a passing reason tries again this much later
const NOTE_ID = /^[A-Za-z0-9-]{1,100}$/;
const FILE_ID = /^[A-Za-z0-9_-]{1,200}$/;
const KEY = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z~[0-9a-f]{16}$/;
const REV = /^[0-9a-f]{16}$/;
const COLOR = /^(#[\da-fA-F]{6}|yellow|pink|blue|green|purple|white|orange)$/;

function iso(value) {
  const time = typeof value === 'string' ? Date.parse(value) : NaN;
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
}
const unique = list => [...new Set(list.filter(Boolean))];
const newestFirst = list => unique(list).sort().reverse();
const revOf = key => key.slice(25);
const readKey = value => (typeof value === 'string' && KEY.test(value) ? value : '');
// A note read from Drive is untrusted input: bounded strings, a known colour, real dates, the id the listing promised.
function sanitizeRemoteNote(raw, noteId, fallbackUpdatedAt) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || raw.id !== noteId || !NOTE_ID.test(noteId) || raw.deleted) return null;
  return {
    id: noteId,
    title: typeof raw.title === 'string' ? raw.title.slice(0, 200) : '',
    body: typeof raw.body === 'string' ? raw.body.slice(0, 100000) : '',
    color: typeof raw.color === 'string' && COLOR.test(raw.color) ? raw.color : 'yellow',
    updatedAt: iso(raw.updatedAt) || iso(fallbackUpdatedAt) || new Date().toISOString(),
    ...(iso(raw.editedAt) ? { editedAt: iso(raw.editedAt) } : {}),
    ...(iso(raw.trashedAt) ? { trashedAt: iso(raw.trashedAt) } : {}),
    ...(raw.pinned === true ? { pinned: true } : {}),
    ...(iso(raw.pinnedAt) ? { pinnedAt: iso(raw.pinnedAt) } : {}),
    ...(readKey(raw.textKey) ? { textKey: readKey(raw.textKey) } : {}),
    past: cleanPast(raw.past),
  };
}
// A note's earlier texts, newest first: bounded and checked like a note (they come from Drive too).
function cleanPast(list) {
  const out = []; let size = 0;
  for (const item of Array.isArray(list) ? list : []) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const entry = { title: typeof item.title === 'string' ? item.title.slice(0, 200) : '', body: typeof item.body === 'string' ? item.body.slice(0, 100000) : '',
      color: typeof item.color === 'string' && COLOR.test(item.color) ? item.color : 'yellow', updatedAt: iso(item.updatedAt), archivedAt: iso(item.archivedAt),
      ...(iso(item.editedAt) ? { editedAt: iso(item.editedAt) } : {}) };
    if (!entry.updatedAt || !entry.archivedAt || out.some(other => other.updatedAt === entry.updatedAt && sameContent(other, entry))) continue;
    size += entry.title.length + entry.body.length;
    if (out.length >= PAST || (out.length && size > PAST_CHARS)) break;
    out.push(entry);
  }
  return out;
}
// Before `note`'s text is replaced by `next`: keep it as an earlier version when it had settled (unchanged SETTLED), when
// the last one kept is SESSION old, when most of it is about to disappear (a select-all-and-delete slip), or when forced.
function archiveText(past, note, at, { next = null, force = false } = {}) {
  const list = cleanPast(past);
  if (!note || (!note.title && !note.body) || (next && sameContent(note, next)) || (list[0] && sameContent(list[0], note))) return list;
  const now = Date.parse(at); const size = text => (text?.title || '').length + (text?.body || '').length;
  const stored = Date.parse(note.storedAt); const times = [note.editedAt, note.updatedAt].map(value => Date.parse(value)).filter(Number.isFinite);
  const since = Number.isFinite(stored) ? stored : Math.min(...times);
  const settled = now - since >= SETTLED;
  const due = Boolean(list[0]) && now - Date.parse(list[0].archivedAt) >= SESSION;
  const loss = Boolean(next) && size(note) >= 100 && size(next) * 2 < size(note);
  if (!force && !settled && !due && !loss) return list;
  return cleanPast([{ title: note.title, body: note.body, color: note.color, updatedAt: note.updatedAt, ...(note.editedAt ? { editedAt: note.editedAt } : {}), archivedAt: new Date(now).toISOString() }, ...list]);
}
// Two lists of earlier texts as one (another PC's version replaced this one): newest first, duplicates once.
function mergePast(a, b) {
  return cleanPast([...cleanPast(a), ...cleanPast(b)].sort((x, y) => (x.updatedAt < y.updatedAt ? 1 : x.updatedAt > y.updatedAt ? -1 : 0)));
}
const readHistory = raw => (Array.isArray(raw?.history) ? unique(raw.history.map(readKey)).slice(0, FILE_HISTORY) : []);
const readAncestors = raw => (Array.isArray(raw?.ancestors) ? unique(raw.ancestors.filter(item => typeof item === 'string' && REV.test(item))).slice(0, ANCESTORS) : []);
const sameContent = (a, b) => a.title === b.title && a.body === b.body && a.color === b.color;
// The copy of a version that lost a conflict. Its id comes from the note and the version, and its title does not depend
// on the language, so resolving the same conflict again (an aborted run, or two PCs at once, even in different languages)
// makes the very same note instead of another (2026-10-21 review: 「(사본)」/「(copy)」 differed between PCs). The typed title
// is never cut: " (2)" is added only when it fits in 200 characters (2026-10-21 review: the last characters were lost).
function copyId(noteId, key) { return `c-${crypto.createHash('sha256').update(`${noteId}:${key}`).digest('hex').slice(0, 32)}`; }
function copyOf(text, noteId, key, updatedAt) {
  const head = String(text.title || '');
  return { id: copyId(noteId, key), title: !head ? '(2)' : head.length <= 196 ? `${head} (2)` : head, body: text.body, color: text.color, updatedAt,
    ...(text.editedAt ? { editedAt: text.editedAt } : {}), ...(text.trashedAt ? { trashedAt: text.trashedAt } : {}), past: [] };
}

function accountMeta(state, accountId) {
  state.noteSync.accounts[accountId] ||= { files: {}, deleted: {}, sent: {} };
  state.noteSync.accounts[accountId].sent ||= {};
  return state.noteSync.accounts[accountId];
}
// A note deleted on this PC. The notes account always records the deletion, covering the version the user saw (`seen`)
// and every version this PC sent of it (a reply lost on the way back): an upload that reached Drive must not bring the note
// back (2026-10-21 reviews). Other accounts record it only for a note they hold. `except` skips one account (a deletion
// that came from it).
function recordNoteDeletion(state, note, deletedAt = new Date().toISOString(), { except = null } = {}) {
  const current = notesAccountId(state);
  const ids = new Set(Object.keys(state.noteSync?.accounts || {}));
  if (current) ids.add(current);
  for (const accountId of ids) {
    if (accountId === except) continue;
    const meta = accountMeta(state, accountId);
    const file = meta.files[note.id];
    if (!file && accountId !== current) continue;
    const history = unique([...(meta.sent[note.id] || []), ...(file?.history || [])]).slice(0, HISTORY * 2);
    meta.deleted[note.id] = { fileId: file?.fileId ?? null, base: file?.base ?? null, history, deletedAt: laterThan(deletedAt, note.updatedAt), seen: noteKey(note), seenText: note.textKey || noteKey(note) };
    delete meta.files[note.id];
    delete meta.sent[note.id];
  }
}

function driveClient(request) {
  const call = (url, options = {}) => request(assertOrigin(url, ['https://www.googleapis.com']), options);
  const fileUrl = fileId => { if (!FILE_ID.test(String(fileId))) throw new Error(tr('Google이 알려 준 메모 파일 정보가 올바르지 않아요.')); return `${DRIVE}/${fileId}`; };
  return {
    async list() {
      const files = []; const seenFiles = new Set(); const seenPages = new Set(); let pageToken = '';
      for (let page = 0; page < 200; page++) {
        const url = new URL(DRIVE);
        url.searchParams.set('spaces', 'appDataFolder');
        url.searchParams.set('pageSize', '1000');
        url.searchParams.set('fields', 'nextPageToken,files(id,modifiedTime,appProperties)');
        // No query: the app data folder holds only Dayboard's own files, and readListing picks by appProperties
        // (2026-10-21 Drive review: no documented example joins two `appProperties has` terms with `or`).
        if (pageToken) url.searchParams.set('pageToken', pageToken);
        const data = await call(url.href);
        // A file can show up on two pages when the folder changes between them: listed once (2026-10-21 review: the
        // "duplicate" was removed — and it was the only file of that version).
        for (const file of Array.isArray(data?.files) ? data.files : []) if (!seenFiles.has(file?.id)) { seenFiles.add(file?.id); files.push(file); }
        pageToken = typeof data?.nextPageToken === 'string' ? data.nextPageToken : '';
        if (!pageToken) return files;
        if (seenPages.has(pageToken)) break;
        seenPages.add(pageToken);
      }
      throw new Error(tr('Google에 보관한 메모 목록을 끝까지 읽지 못했어요. 잠시 후 다시 시도해 주세요.'));
    },
    get: fileId => call(`${fileUrl(fileId)}?alt=media`),
    async create(metadata, content) {
      const boundary = `dayboard-${crypto.randomUUID()}`;
      const body = [`--${boundary}`, 'Content-Type: application/json; charset=UTF-8', '', JSON.stringify({ ...metadata, parents: ['appDataFolder'], mimeType: 'application/json' }),
        `--${boundary}`, 'Content-Type: application/json; charset=UTF-8', '', content, `--${boundary}--`, ''].join('\r\n');
      return call(`${UPLOAD}?uploadType=multipart&fields=id`, { method: 'POST', headers: { 'Content-Type': `multipart/related; boundary=${boundary}` }, body });
    },
    remove: fileId => call(fileUrl(fileId), { method: 'DELETE' }),
  };
}

// The listing, as noteId → versions [{ fileId, updatedAt, key, prev, deleted, modifiedTime }]; malformed entries are
// skipped (a file without a valid rev gets a key no local version has, so it is never taken for one).
function readListing(files) {
  const byNote = new Map();
  for (const file of Array.isArray(files) ? files : []) {
    const props = file?.appProperties && typeof file.appProperties === 'object' ? file.appProperties : {};
    const noteId = typeof props.noteId === 'string' ? props.noteId : '';
    const updatedAt = iso(props.updatedAt);
    if (props.dayboard !== 'note' || !FILE_ID.test(String(file?.id || '')) || !NOTE_ID.test(noteId) || !updatedAt) continue;
    const rev = typeof props.rev === 'string' && REV.test(props.rev) ? props.rev : '0'.repeat(16);
    if (!byNote.has(noteId)) byNote.set(noteId, []);
    byNote.get(noteId).push({ fileId: file.id, updatedAt, key: `${updatedAt}~${rev}`, prev: readKey(props.prev), deleted: props.deleted === '1', modifiedTime: iso(file.modifiedTime) });
  }
  return byNote;
}

// Google's 403s mean different things; only a missing grant is fixed by signing in again.
function notesError(error) {
  const reason = String(error?.reason || '');
  // Reason codes from developers.google.com/workspace/drive/api/guides/handle-errors (exact names: a broad pattern also
  // matched lasting limits such as activeItemCreationLimitExceeded, shown as "in a few minutes").
  if (error?.status === 429 || /^(rateLimitExceeded|userRateLimitExceeded|dailyLimitExceeded|RATE_LIMIT_EXCEEDED|RESOURCE_EXHAUSTED)$/.test(reason)) return tr('Google이 잠시 요청을 막았어요. 몇 분 뒤 다시 동기화해요.');
  if (reason === 'storageQuotaExceeded') return tr('Google 저장 공간이 가득 차 메모를 보관하지 못했어요.');
  if (/^(accessNotConfigured|SERVICE_DISABLED)$/.test(reason)) return tr('Google 드라이브 API가 꺼져 있어 메모를 보관할 수 없어요.');
  if (reason === 'domainPolicy') return tr('조직 관리자가 이 앱의 Google 드라이브 사용을 막았어요.');
  if (/^(activeItemCreationLimitExceeded|numChildrenInNonRootLimitExceeded)$/.test(reason)) return tr('Google 드라이브 파일 수 한도에 걸려 메모를 보관하지 못했어요.');
  if (error?.status === 403 || error?.status === 401) return tr('Google이 메모 보관을 허용하지 않았어요. 계정 관리에서 다시 로그인해 주세요.') + ` (HTTP ${error.status})`;
  return error?.message || String(error);
}
const stops = error => [401, 403, 429].includes(error?.status);
// The notes account changed (switched, turned off or disconnected) during a run: it stops quietly and writes nothing more
// there (2026-10-21 review: a run went on uploading to an account just disconnected).
class Switched extends Error {}
const halts = error => stops(error) || error instanceof Switched;

function createNotesSync({ store, change, requestFor, hasAccess, onNotesRemoved = () => {}, beforeApply = async () => {}, delay = 3000, retryDelay = RETRY, now = () => new Date() }) {
  let running = null; let again = false; let timer = null; let disposed = false;
  const setStatus = patch => {
    const status = store.get().noteSync.status;
    if (Object.entries(patch).every(([key, value]) => status[key] === value)) return; // nothing to show: no redraw
    change(state => { Object.assign(state.noteSync.status, patch); });
  };
  // A run that failed for a passing reason (a lost connection, a server hiccup, one file that could not go up) tries again
  // a minute later instead of waiting for the 5-minute round — and the quit flush sends it (2026-10-21 review).
  const retryLater = () => {
    if (disposed || timer || !notesAccountId(store.get())) return;
    timer = setTimeout(() => { timer = null; sync().catch(() => {}); }, retryDelay);
    timer.unref?.();
  };

  async function runOnce(retryStale = true) {
    const accountId = notesAccountId(store.get());
    if (!accountId) { setStatus({ busy: false, pending: false, error: null }); return { synced: false }; }
    if (!hasAccess(accountId)) { setStatus({ busy: false, pending: false, error: tr('Google 계정을 다시 로그인하면 메모를 동기화할 수 있어요.') }); return { synced: false }; }
    // Shown as syncing while an edit waits, and on the first run with this account (nothing has been synced yet).
    { const status = store.get().noteSync.status; if (status.pending || !status.lastSync) setStatus({ busy: true, pending: false }); }
    const drive = driveClient(requestFor(accountId));
    const problems = [];
    const ours = () => { if (notesAccountId(store.get()) !== accountId) throw new Switched(); };
    let stale = false;
    try {
      const files = await drive.list();
      const listing = readListing(files);
      const before = store.get();
      const meta = structuredClone(before.noteSync.accounts[accountId] || { files: {}, deleted: {}, sent: {} });
      meta.sent ||= {};
      const local = new Map(before.notes.map(note => [note.id, note]));
      const ids = new Set([...local.keys(), ...listing.keys(), ...Object.keys(meta.deleted), ...Object.keys(meta.files), ...Object.keys(meta.sent)]);
      const ops = []; const copies = []; const removals = new Set();
      const contents = new Map();
      const contentOf = async version => {
        if (!contents.has(version.fileId)) contents.set(version.fileId, await drive.get(version.fileId));
        return contents.get(version.fileId);
      };
      // What a Drive version says it replaces: keys (`history`, with `prev`) and revs (`ancestors`).
      const infoOf = async version => {
        if (!version.history) {
          const content = await contentOf(version);
          version.history = unique([version.prev, ...readHistory(content)]).slice(0, FILE_HISTORY);
          version.ancestors = readAncestors(content);
          version.seenText = readKey(content?.seenText); // a deletion: the text it deleted
          version.from = readKey(content?.from); version.pinBy = readKey(content?.pinBy); version.pinText = readKey(content?.pinText);
        }
        return version;
      };
      const historyOf = async version => (await infoOf(version)).history;
      // `later` replaces `key` (only ever a smaller key: replacement links are acyclic).
      const replaces = (later, key) => later.key > key && (later.prev === key || (later.history || []).includes(key) || (later.ancestors || []).includes(revOf(key)));
      const textOf = async version => {
        if (version.local) return version.note;
        const note = sanitizeRemoteNote(await contentOf(version), version.noteId, version.updatedAt);
        if (note) note.updatedAt = version.updatedAt; // the listing's version is what later runs compare with
        return note;
      };
      // What a new version replaces: the heads it claims and everything they replaced (so a long chain of edits stays
      // provable to a PC that was switched off), plus this PC's own lineage — all with smaller keys.
      const lineageFor = async (key, claimed, lineage) => {
        const keys = []; const revs = [];
        for (const head of claimed) { await infoOf(head); keys.push(head.key, ...head.history); revs.push(...head.ancestors); }
        const history = newestFirst([...keys, ...lineage].filter(item => item < key)).slice(0, FILE_HISTORY);
        const ancestors = unique([...history.map(revOf), ...revs]).slice(0, ANCESTORS);
        return { history, ancestors };
      };
      // Recorded before the upload, silently: if the reply is lost or the run dies, this PC still knows it built on it.
      const remember = (noteId, key) => store.mutate(state => {
        const target = accountMeta(state, accountId);
        target.sent[noteId] = unique([key, ...(target.sent[noteId] || [])]).slice(0, HISTORY);
      });
      // `own: false` for a version this PC makes from other PCs' texts (a merge): the note here is not built on it, so it is
      // not this PC's lineage (2026-10-21 fuzz: typing during the run was then taken as built on the merge, which it replaced).
      async function upload(note, key, { prev, history, ancestors = [], deleted, own = true, seenText = '', extra = {} }) {
        ours();
        if (own) remember(note.id, key);
        const appProperties = { dayboard: 'note', noteId: note.id, updatedAt: note.updatedAt, rev: revOf(key), ...(prev ? { prev } : {}), ...(deleted ? { deleted: '1' } : {}) };
        const content = JSON.stringify(deleted ? { v: 2, id: note.id, deleted: true, updatedAt: note.updatedAt, history, ancestors, ...(seenText ? { seenText } : {}) }
          : { v: 2, id: note.id, title: note.title, body: note.body, color: note.color, updatedAt: note.updatedAt, ...(note.editedAt ? { editedAt: note.editedAt } : {}),
            ...(note.trashedAt ? { trashedAt: note.trashedAt } : {}), ...(note.pinned ? { pinned: true } : {}), ...(note.pinnedAt ? { pinnedAt: note.pinnedAt } : {}), ...(note.textKey ? { textKey: note.textKey } : {}), past: cleanPast(note.past), history, ancestors, ...extra });
        const made = await drive.create({ name: `note-${note.id}.json`, appProperties }, content);
        if (!FILE_ID.test(String(made?.id || ''))) throw new Error(tr('Google이 메모 보관 결과를 돌려주지 않았어요.'));
        return made.id;
      }
      // Deletion versions expire by Drive's clock: the newest modifiedTime Drive set (Dayboard never sends one), never a
      // PC clock that runs ahead. A quiet folder keeps them longer, the safe direction.
      const serverNow = files.reduce((latest, file) => Math.max(latest, Date.parse(file?.modifiedTime) || 0), 0);
      const cutoff = Math.min(now().getTime(), serverNow || Infinity) - TOMBSTONE_DAYS * 86400000;

      for (const noteId of ids) {
        const n = local.get(noteId) || null; const m = meta.files[noteId] || null; const t = meta.deleted[noteId] || null;
        const nKey = n ? noteKey(n) : null;
        try {
          // 1. The same version stored twice (an upload repeated after a timeout): keep one file. Same key = same text.
          const byVersion = new Map();
          for (const version of (listing.get(noteId) || []).map(item => ({ ...item, noteId }))) {
            const kept = byVersion.get(version.key);
            if (!kept) byVersion.set(version.key, version);
            else if (kept.fileId !== version.fileId) removals.add(version.fileId);
          }
          const versions = [...byVersion.values()];
          // 2. Heads: versions no other version replaces (by `prev`, then by history and ancestors when several remain).
          let heads = versions.filter(item => !versions.some(other => other.prev === item.key && other.key > item.key));
          if (heads.length > 1) {
            for (const head of heads) await infoOf(head);
            heads = heads.filter(item => !heads.some(other => other !== item && replaces(other, item.key)));
          }
          for (const version of versions) if (!heads.includes(version)) removals.add(version.fileId); // proven replaced
          // 3. This PC's version when Drive does not have it: an edit, a never-uploaded note, a deletion, or (after the
          //    folder was emptied) the agreed version itself. Its lineage: what it was built on, including what it sent.
          const base = m?.base ?? t?.base ?? null;
          //    The text it was built on counts too: the agreed version's text (`text`), the deleted text (`seenText`), and the
          //    version that brought this PC's own text (its textKey — a pin, a trash or a restore right after an edit goes up
          //    alone, and the edit's key was then in no lineage: 2026-10-21 review).
          const lineage = unique([t?.seen, t?.seenText, ...(meta.sent[noteId] || []), base, m?.text, ...(m?.history || t?.history || [])]).slice(0, HISTORY * 2);
          let mine = null;
          if (t && !n) { const key = deletionKey(noteId, t.deletedAt, t.seen); mine = { local: true, deleted: true, noteId, updatedAt: t.deletedAt, key, seenText: t.seenText || '', ancestry: lineage.filter(item => item !== key) }; }
          else if (n && !versions.some(item => item.key === nKey)) mine = { local: true, noteId, updatedAt: n.updatedAt, key: nKey, note: n, ...(m && m.base === nKey && m.from ? { from: m.from, pinBy: m.pinBy || '', pinText: m.pinText || '' } : {}), ancestry: unique([...lineage, n.textKey && n.textKey < nKey ? n.textKey : '']).filter(item => item !== nKey) };
          // Nothing new: Drive holds exactly the version this PC has and already agreed with (no download).
          if (!mine && !t && n && m && versions.length === 1 && m.fileId === versions[0].fileId && m.base === nKey) continue;
          // 4. Live versions: a head this PC's version descends from is replaced by it; this PC's version is replaced by a
          //    head that descends from it (it went up before and the bookkeeping was lost, or another PC built on it).
          let live = heads.slice(); const replacedByMine = [];
          if (mine) {
            for (const head of live) if (mine.ancestry.includes(head.key)) replacedByMine.push(head);
            live = live.filter(head => !replacedByMine.includes(head));
            let superseded = live.some(head => head.prev === mine.key && head.key > mine.key);
            for (const head of live) { if (superseded) break; if (head.key > mine.key && replaces(await infoOf(head), mine.key)) superseded = true; }
            if (!superseded) live.push(mine);
          }
          let texts = live.filter(item => !item.deleted);
          // A pin, trash or restore of a text that a deletion replaced through a later text (the user rewrote it, then
          // deleted it) has nothing to bring back: it goes with the deletion. A pin of the very text that was deleted still
          // brings the note back (2026-10-21 review: an offline PC's pin revived a rewritten-then-deleted note).
          const deletions = live.filter(item => item.deleted);
          if (texts.length && deletions.length) {
            for (const mark of deletions) if (!mark.local) await infoOf(mark);
            const keep = [];
            for (const version of texts) {
              const text = await textOf(version);
              const tk = (text && text.textKey) || version.key;
              if (!version.local) await infoOf(version);
              // A merged version names where its parts came from (`from` its text, `pinBy`/`pinText` an added pin): it is
              // stale too when the deletion saw its text and the pin it added was stale or seen — the same rule whichever of
              // the pin and the deletion reached Drive first (2026-10-21 review round 6).
              const seenBy = (mark, key) => Boolean(key) && (mark.local ? mark.ancestry.includes(key) : replaces(mark, key));
              const staleText = (mark, key) => Boolean(mark.seenText) && Boolean(key) && mark.seenText !== key && seenBy(mark, key);
              const stale = Boolean(text) && deletions.some(mark => (tk !== version.key && staleText(mark, tk))
                || (Boolean(version.from) && seenBy(mark, version.from) && (!version.pinBy || version.pinBy === version.from || seenBy(mark, version.pinBy) || staleText(mark, version.pinText))));
              if (stale) { if (!version.local) removals.add(version.fileId); } else keep.push(version);
            }
            if (keep.length < texts.length) { live = live.filter(item => item.deleted || keep.includes(item)); texts = keep; }
          }
          // 5a. Deleted everywhere that matters (only deletion versions left).
          if (!texts.length) {
            const standing = live.filter(item => !item.local && item.deleted);
            if (mine?.deleted && live.includes(mine)) {
              // This PC's deletion goes up unless the deletions already on Drive name every version it replaces; it claims
              // the smaller ones (2026-10-21 review: an older deletion stood, and the newest text came back).
              for (const mark of standing) await infoOf(mark);
              if (!standing.length || replacedByMine.some(head => !standing.some(mark => replaces(mark, head.key)))) {
                const claimed = [...replacedByMine, ...standing.filter(mark => mark.key < mine.key)];
                const { history, ancestors } = await lineageFor(mine.key, claimed, mine.ancestry);
                await upload({ id: noteId, updatedAt: mine.updatedAt }, mine.key, { prev: mine.ancestry[0] || '', history, ancestors, deleted: true, seenText: mine.seenText });
              }
              // Versions this PC deleted are replaced by a deletion now on Drive (its own, or another PC's).
              for (const head of replacedByMine) removals.add(head.fileId);
            }
            // Extra deletions go only when a kept one names everything they name — never by key order, which a clock ahead
            // decides (2026-10-21 review: the kept one did not name the newest text, and it came back).
            const marks = standing.slice().sort((a, b) => (a.key < b.key ? 1 : -1));
            const kept = [];
            for (const mark of marks) {
              if (marks.length > 1) await infoOf(mark);
              const names = unique([mark.prev, ...(mark.history || [])]);
              if (kept.length && kept.some(other => names.every(key => replaces(other, key) || other.prev === key))) removals.add(mark.fileId);
              else kept.push(mark);
            }
            // A deletion every PC has had months to see is removed by Drive's clock (not a PC's).
            for (const mark of kept) if (!n && !t && mark.modifiedTime && Date.parse(mark.modifiedTime) < cutoff) removals.add(mark.fileId);
            if (n) ops.push({ type: 'remove', noteId, expect: n.updatedAt, expectKey: nKey });
            if (t) ops.push({ type: 'tomb-done', noteId, deletedAt: t.deletedAt });
            if (!n && !t && (m || meta.sent[noteId])) ops.push({ type: 'forget', noteId });
            continue;
          }
          // 5b. The newest text (largest key) wins — the same choice on every PC; every other text is kept first, as a copy.
          const winner = texts.reduce((a, b) => (b.key > a.key ? b : a));
          const won = n && nKey === winner.key ? n : await textOf(winner); // the version this PC has: no download
          if (!won) { problems.push(tr('읽을 수 없는 메모 파일을 건너뛰었어요.')); continue; }
          // Which text each head carries (textKey: the version that brought it; a pin, a trash or a restore keeps it). A head
          // whose text another head was built on carries nothing of its own: it is not copied, and its pin is merged into
          // the text that stays — one merged version when the text that stays is not the newest head, or a pin would go
          // (2026-10-21 review round 4: a pin on one PC and an edit on another left a 「(2)」 copy and lost the pin).
          const info = new Map([[winner, { text: won, tk: won.textKey || winner.key }]]);
          if (texts.length > 1) for (const version of texts) {
            if (!version.local) await infoOf(version);
            if (info.has(version)) continue;
            const text = await textOf(version);
            if (text) info.set(version, { text, tk: text.textKey || version.key });
          }
          const builtOn = (head, key) => head.key === key || (head.local ? head.ancestry.includes(key) : replaces(head, key));
          // Copies are kept per text, not per version: a pin of a text that already has its copy (here, on Drive, made this
          // run, or deleted by the user) carries nothing either (2026-10-21 review: one failed copy upload left the text
          // twice and the winner flipped).
          const keptCopy = version => { const tk = info.get(version).tk; if (tk === version.key) return false; const id = copyId(noteId, tk); return local.has(id) || listing.has(id) || Boolean(meta.deleted[id]) || copies.some(item => item.note.id === id); };
          const carriesNothing = version => info.has(version) && (keptCopy(version) || texts.some(head => head !== version && info.has(head) && !sameContent(info.get(head).text, info.get(version).text) && builtOn(head, info.get(version).tk)));
          const carriers = texts.filter(version => info.has(version) && !carriesNothing(version));
          const textWinner = carriers.length ? carriers.reduce((a, b) => (b.key > a.key ? b : a)) : winner;
          const final = info.get(textWinner).text;
          // The pin comes from whichever of the text that stays, the heads that carry nothing and the heads with the same text
          // changed it last (pinnedAt): an unpin on one PC is not undone by an edit, a trash or a restore on another that kept
          // the old pin; with no times any pin wins (2026-10-21 reviews).
          const pinHeads = [textWinner, ...texts.filter(version => version !== textWinner && info.has(version) && (carriesNothing(version) || sameContent(info.get(version).text, final)))];
          const pinFrom = pinHeads.map(version => info.get(version).text);
          const pinTime = pinFrom.reduce((latest, text) => ((text.pinnedAt || '') > latest ? text.pinnedAt : latest), '');
          const pinned = pinFrom.some(text => (text.pinnedAt || '') === pinTime && text.pinned);
          const merge = textWinner !== winner || pinned !== Boolean(final.pinned);
          const pinSrc = pinTime ? pinHeads.find(version => (info.get(version).text.pinnedAt || '') === pinTime && Boolean(info.get(version).text.pinned) === pinned) : (pinned !== Boolean(final.pinned) ? pinHeads.find(version => info.get(version).text.pinned) : null);
          const keptAside = new Set();
          if (merge) keptAside.add(winner);
          for (const version of texts) {
            if (version === textWinner) continue;
            const text = info.get(version)?.text || await textOf(version);
            if (!text) { problems.push(tr('읽을 수 없는 메모 파일을 건너뛰었어요.')); continue; }
            if (sameContent(text, final) || carriesNothing(version)) {
              keptAside.add(version);
              // A restore (or a pin) out of the trash whose text now lives on only as a 「(2)」 copy in the trash: the copy comes
              // out of the trash too, as note:restore would — the user's last act on that text was to restore it (2026-10-21
              // review round 6: the restore was dropped and the text left on the 30-day purge clock).
              const tk = info.get(version)?.tk;
              if (carriesNothing(version) && !text.trashedAt && tk && tk !== version.key) {
                const id = copyId(noteId, tk);
                let copy = local.get(id) || null;
                const copyHeads = listing.get(id) || [];
                const copyKeys = new Set(copyHeads.map(item => item.key));
                // The copy's state on Drive counts, not only this PC's copy: a deletion of it, or a version of it this PC has not
                // seen (deleted for good or trashed again elsewhere), stops the restore; one version listed as several files
                // (an upload repeated after a lost reply) is one version (2026-10-21 review round 7).
                let probe = copy; const unseen = Boolean(copy) && [...copyKeys].some(key => key !== noteKey(copy) && key !== meta.files[id]?.base);
                if (copyHeads.some(item => item.deleted) || (unseen && copyKeys.size !== 1)) copy = probe = null;
                else if (unseen) { const head = copyHeads[0]; probe = sanitizeRemoteNote(await drive.get(head.fileId), id, head.updatedAt); if (probe) probe.updatedAt = head.updatedAt; else copy = null; }
                else if (!copy && !meta.deleted[id] && copyKeys.size === 1) { const head = copyHeads[0]; copy = probe = sanitizeRemoteNote(await drive.get(head.fileId), id, head.updatedAt); if (copy) copy.updatedAt = head.updatedAt; }
                if (copy && probe && probe.trashedAt && version.updatedAt > probe.updatedAt) {
                  const seen = noteKey(copy); const stamp = now().toISOString();
                  change(state => {
                    const here = state.notes.find(item => item.id === id);
                    if (here && noteKey(here) !== seen) return;
                    if (!here && state.noteSync.accounts[accountId]?.deleted?.[id]) return;
                    const next = { ...(here || copy), updatedAt: laterThan(stamp, probe.updatedAt > copy.updatedAt ? probe.updatedAt : copy.updatedAt), textKey: copy.textKey || seen, storedAt: (here && here.storedAt) || stamp };
                    delete next.trashedAt; delete next.trashSeenAt;
                    if (here) state.notes = state.notes.map(item => item.id === id ? next : item); else state.notes.push(next);
                  });
                }
              }
              continue;
            }
            const copy = copyOf(text, noteId, info.get(version)?.tk || version.key, version.updatedAt);
            const copyKey = noteKey(copy);
            // Here already, or deleted here by the user (pending): the user's choice either way (2026-10-21 review).
            if (local.has(copy.id) || meta.deleted[copy.id] || copies.some(item => item.note.id === copy.id)) { keptAside.add(version); continue; }
            const listed = (listing.get(copy.id) || []).find(item => item.key === copyKey);
            if (listing.has(copy.id) && !listed) { keptAside.add(version); continue; } // the copy was changed or deleted since: the user's choice
            // Another PC's text is saved here before anything goes up or is removed, so the PC that retires a version
            // always holds its text itself — even if this run stops halfway or the folder is deleted before the copy is
            // downloaded elsewhere (2026-10-21 fuzz). This PC's own text stays here until the change at the end.
            if (!version.local) change(state => { if (!state.notes.some(item => item.id === copy.id) && !state.noteSync.accounts[accountId]?.deleted?.[copy.id]) state.notes.push({ ...copy, storedAt: now().toISOString() }); });
            if (listed) { copies.push({ note: copy, fileId: listed.fileId, shown: !version.local, source: version.local ? noteId : null, sourceText: version.local ? (info.get(version)?.tk || version.key) : null }); keptAside.add(version); continue; } // up already
            let fileId = null;
            try { fileId = await upload(copy, copyKey, { prev: '', history: [] }); keptAside.add(version); }
            catch (error) { if (halts(error)) throw error; problems.push(error.message); } // the copy stays here and goes up next run
            copies.push({ note: copy, fileId, shown: !version.local, source: version.local ? noteId : null, sourceText: version.local ? (info.get(version)?.tk || version.key) : null });
          }
          // 5c. The winner becomes the one version on Drive and here.
          const others = live.filter(item => item !== winner && !item.local && !(merge && item === textWinner));
          const safe = head => head.deleted || keptAside.has(head);
          let winnerInfo = winner;
          if (merge) {
            const at = now().toISOString();
            const merged = { id: noteId, title: final.title, body: final.body, color: final.color, updatedAt: laterThan(at, winner.updatedAt), ...(final.editedAt ? { editedAt: final.editedAt } : {}),
              ...(final.trashedAt ? { trashedAt: final.trashedAt } : {}), ...(pinned ? { pinned: true } : {}), ...(pinTime ? { pinnedAt: pinTime } : {}), textKey: info.get(textWinner).tk,
              past: texts.reduce((list, version) => (info.has(version) ? mergePast(list, info.get(version).text.past) : list), []) };
            const key = noteKey(merged);
            const remote = live.filter(item => !item.local);
            const claimed = [...remote.filter(head => (head.deleted || keptAside.has(head) || head === textWinner) && head.key < key), ...replacedByMine];
            const own = mine && texts.includes(mine) ? [mine.key, ...mine.ancestry] : [];
            // The note here is built on its own version, which the merge does not put in this PC's lineage: typing during the
            // run then still counts as built on it (2026-10-21 review: the user's previous text became a 「(2)」 copy).
            if (own.length) remember(noteId, mine.key);
            const { history, ancestors } = await lineageFor(key, claimed, own);
            const extra = { from: textWinner.key, ...(pinSrc && pinSrc !== textWinner ? { pinBy: pinSrc.key, pinText: info.get(pinSrc).tk } : {}) };
            const fileId = await upload(merged, key, { prev: winner.key, history, ancestors, own: false, extra });
            winnerInfo = { key, prev: winner.key, history, ancestors };
            ops.push({ type: 'put', noteId, note: merged, expect: n ? n.updatedAt : null, expectKey: nKey, adopt: true, revive: Boolean(t), meta: { fileId, base: key, history: history.slice(0, HISTORY), text: info.get(textWinner).tk, ...extra } });
            for (const head of replacedByMine) removals.add(head.fileId);
            for (const head of remote) if (head === winner || head === textWinner) removals.add(head.fileId);
          } else if (winner.local) {
            // The new version claims only heads whose text is safe and whose key is smaller; one whose copy could not go up
            // stays a head until it can. A later deletion retired without a claim hands on what it named (2026-10-21 review:
            // otherwise the version it deleted came back as a copy).
            const claimed = [...others.filter(head => safe(head) && head.key < winner.key), ...replacedByMine];
            const passedOn = [];
            for (const head of others) if (head.deleted && head.key > winner.key) passedOn.push(...(await historyOf(head)));
            const { history, ancestors } = await lineageFor(winner.key, claimed, [...winner.ancestry, ...passedOn]);
            const prev = winner.ancestry[0] || claimed[0]?.key || '';
            let past = cleanPast(won.past);
            for (const head of others) if (!head.deleted && claimed.includes(head)) { const text = await textOf(head); if (text) past = mergePast(past, text.past); }
            const merged = JSON.stringify(past) !== JSON.stringify(cleanPast(won.past));
            const fileId = await upload(merged ? { ...won, past } : won, winner.key, { prev, history, ancestors });
            winnerInfo = { key: winner.key, prev, history, ancestors };
            ops.push({ type: 'uploaded', noteId, expect: won.updatedAt, expectKey: winner.key, ...(merged ? { past } : {}), meta: { fileId, base: winner.key, history: history.slice(0, HISTORY), text: won.textKey || winner.key } });
            for (const head of replacedByMine) removals.add(head.fileId);
          } else {
            const history = (await historyOf(winner)).slice(0, HISTORY);
            const agreed = { fileId: winner.fileId, base: winner.key, history, text: won.textKey || winner.key, ...(winner.from ? { from: winner.from } : {}), ...(winner.pinBy ? { pinBy: winner.pinBy, pinText: winner.pinText } : {}) };
            if (n && nKey === winner.key) ops.push({ type: 'meta', noteId, expect: n.updatedAt, expectKey: nKey, meta: agreed });
            else ops.push({ type: 'put', noteId, note: won, expect: n ? n.updatedAt : null, expectKey: nKey, adopt: Boolean(n) && replaces(winner, nKey), revive: Boolean(t), meta: agreed });
            if (mine && !mine.deleted && live.includes(mine) && !keptAside.has(mine)) problems.push(tr('이 PC의 메모 사본을 아직 올리지 못했어요.'));
            // Versions this PC built on are replaced: its own text is kept (a copy) or stays here until the change below.
            for (const head of replacedByMine) removals.add(head.fileId);
          }
          if (t) ops.push({ type: 'tomb-done', noteId, deletedAt: t.deletedAt });
          // Retire the other heads only once their text is safe (a copy, the same text) — a deletion only once the winner
          // replaces all it names or it expired (it then stands beside the text and supersedes the deleted texts it names).
          for (const head of others) {
            if (!safe(head)) continue;
            if (head.deleted) {
              await infoOf(head);
              const names = unique([head.prev, ...(head.history || [])]);
              const covered = names.every(key => replaces(winnerInfo, key));
              const expired = head.modifiedTime && Date.parse(head.modifiedTime) < cutoff;
              if (!covered && !expired) continue;
            }
            removals.add(head.fileId);
          }
        } catch (error) {
          if (halts(error)) throw error;
          // Another PC retired a version between the listing and its download: the note is decided again from a fresh
          // listing (once), not shown as a problem (2026-10-21 review).
          if (error?.status === 404 && retryStale) { stale = true; continue; }
          problems.push(error.message);
        }
      }
      for (const fileId of removals) {
        try { ours(); await drive.remove(fileId); }
        catch (error) { if (halts(error)) throw error; if (error.status !== 404) problems.push(error.message); }
      }

      // Unsaved typing is saved before notes are replaced or removed here, so the checks below see it.
      if (ops.some(op => (op.type === 'put' && op.expect) || op.type === 'remove')) await beforeApply();
      ours();
      const removedWidgets = []; const removedNotes = [];
      const at = now().toISOString();
      const anything = ops.length || copies.length || problems.length || store.get().noteSync.status.error || store.get().noteSync.status.busy;
      if (anything) change(state => {
        const target = accountMeta(state, accountId);
        const current = new Map(state.notes.map(note => [note.id, note]));
        for (const op of ops) {
          const mine = current.get(op.noteId);
          if (op.type === 'uploaded') {
            if (mine) {
              target.files[op.noteId] = op.meta; delete target.sent[op.noteId];
              if (op.past && noteKey(mine) === op.expectKey) state.notes = state.notes.map(note => note.id === op.noteId ? { ...note, past: mergePast(note.past, op.past) } : note);
            }
            // Deleted here while it went up: the deletion now covers the version just uploaded.
            else if (target.deleted[op.noteId]) Object.assign(target.deleted[op.noteId], { fileId: op.meta.fileId, base: op.meta.base, history: op.meta.history });
            else target.deleted[op.noteId] = { ...op.meta, deletedAt: laterThan(at, op.expect), seen: op.meta.base, seenText: op.meta.text };
          } else if (op.type === 'meta') {
            if (mine && noteKey(mine) === op.expectKey) { target.files[op.noteId] = op.meta; delete target.sent[op.noteId]; }
          } else if (op.type === 'put') {
            if (mine && noteKey(mine) !== op.expectKey) continue; // typed into meanwhile: decided again next run
            if (!mine && op.expect) continue;                   // deleted here meanwhile: its deletion is handled next run
            if (!mine && !op.revive && target.deleted[op.noteId]) continue;
            if (mine) {
              // The replaced text joins the earlier versions (if it had settled); the other PC's list is merged in.
              // Built on this PC's version: the editing PC already decided which texts to keep (adopted as is).
              const next = { ...mine, ...op.note, past: op.adopt ? mergePast(op.note.past, mine.past) : mergePast(op.note.past, archiveText(mine.past, mine, at, { next: op.note })) };
              if (sameContent(mine, op.note)) { if (mine.storedAt) next.storedAt = mine.storedAt; } else next.storedAt = at;
              if (!op.note.trashedAt) { delete next.trashedAt; delete next.trashSeenAt; }
              if (!op.note.editedAt) delete next.editedAt;
              if (!op.note.pinned) delete next.pinned;
              if (!op.note.pinnedAt) delete next.pinnedAt;
              if (!op.note.textKey) delete next.textKey;
              // Moved to 「최근 삭제한 메모」 on another PC (again, with a new time, counts too): its 30 days start now on this
              // PC, and its widgets close.
              if (next.trashedAt && next.trashedAt !== mine.trashedAt) next.trashSeenAt = at;
              if (next.trashedAt && !mine.trashedAt) {
                for (const widget of state.widgets.filter(item => item.type === 'note' && item.noteId === op.noteId)) removedWidgets.push(widget.id);
                state.widgets = state.widgets.filter(item => !(item.type === 'note' && item.noteId === op.noteId));
                removedNotes.push(op.noteId);
              }
              state.notes = state.notes.map(note => note.id === op.noteId ? next : note);
            } else state.notes.push({ ...op.note, storedAt: at, ...(op.note.trashedAt ? { trashSeenAt: at } : {}) });
            target.files[op.noteId] = op.meta;
            delete target.sent[op.noteId];
            if (op.revive) delete target.deleted[op.noteId];
          } else if (op.type === 'remove') {
            if (!mine || noteKey(mine) !== op.expectKey) continue;
            state.notes = state.notes.filter(note => note.id !== op.noteId);
            for (const widget of state.widgets.filter(item => item.type === 'note' && item.noteId === op.noteId)) removedWidgets.push(widget.id);
            state.widgets = state.widgets.filter(item => !(item.type === 'note' && item.noteId === op.noteId));
            delete target.files[op.noteId];
            delete target.sent[op.noteId];
            recordNoteDeletion(state, mine, at, { except: accountId }); // other Google accounts that still hold it
            removedNotes.push(op.noteId);
          } else if (op.type === 'tomb-done') {
            if (target.deleted[op.noteId]?.deletedAt === op.deletedAt) delete target.deleted[op.noteId];
            // The live notes, not the snapshot: a revive in this same change keeps its bookkeeping (2026-10-21 review).
            if (!state.notes.some(note => note.id === op.noteId)) { delete target.files[op.noteId]; delete target.sent[op.noteId]; }
          } else if (op.type === 'forget') {
            if (!state.notes.some(note => note.id === op.noteId)) { delete target.files[op.noteId]; delete target.sent[op.noteId]; }
          }
        }
        // A copy of this PC's own text that is not kept: its file is covered by a deletion — also when the upload's reply was
        // lost and the file may be on Drive all the same (its key is in `sent`; 2026-10-21 review round 7: it came back as 「(2)」).
        const dropCopy = (note, fileId) => {
          const sent = target.sent[note.id] || [];
          if ((fileId || sent.includes(noteKey(note))) && !target.deleted[note.id]) target.deleted[note.id] = { fileId: fileId || null, base: noteKey(note), history: sent, deletedAt: laterThan(at, note.updatedAt), seen: noteKey(note) };
          delete target.sent[note.id];
        };
        for (const { note, fileId, shown, source, sourceText } of copies) {
          // This PC's own text, erased here while the run went on: the copy stays gone (2026-10-21 review round 4: it came
          // back on every PC as 「(2)」).
          if (source && !state.notes.some(item => item.id === source) && target.deleted[source]) { dropCopy(note, fileId); continue; }
          // This PC's own text, typed over here while the run went on (the note as it stands before this change no longer
          // carries that text): the typing replaced it, so the copy is dropped; a pin or trash meanwhile keeps the text and the
          // copy (2026-10-21 review round 6: the user's previous text stayed as 「(2)」).
          if (source && sourceText) {
            const here = current.get(source);
            if (here && (here.textKey || noteKey(here)) !== sourceText) { dropCopy(note, fileId); continue; }
          }
          // A copy of another PC's text the user deleted while this run went on stays deleted; the deletion now covers the
          // copy's file (2026-10-21 review: it came back on every PC).
          if (shown && target.deleted[note.id]) { if (fileId) Object.assign(target.deleted[note.id], { fileId, base: noteKey(note) }); continue; }
          if (!state.notes.some(item => item.id === note.id)) state.notes.push({ ...note, storedAt: at });
          if (fileId) { target.files[note.id] = { fileId, base: noteKey(note), history: [] }; delete target.sent[note.id]; }
        }
        Object.assign(state.noteSync.status, { busy: false, lastSync: at, error: problems.length ? unique(problems).join(' ') : null });
      });
      if (removedNotes.length) onNotesRemoved({ noteIds: removedNotes, widgetIds: removedWidgets });
      if (stale && retryStale) return runOnce(false);
      if (problems.length) retryLater();
      return { synced: true, problems };
    } catch (error) {
      if (error instanceof Switched) { setStatus({ busy: false }); return { synced: false }; }
      setStatus({ busy: false, error: notesError(error) });
      if (!stops(error)) retryLater(); // a refused sign-in waits for the user; Google asking to wait waits for the next round
      throw error;
    }
  }

  // One run at a time; a request during a run starts one more right after it.
  function sync() {
    if (disposed) return Promise.resolve({ synced: false });
    if (running) { again = true; return running; }
    running = (async () => {
      try { return await runOnce(); }
      finally {
        running = null;
        if (again && !disposed) { again = false; sync().catch(() => {}); }
      }
    })();
    return running;
  }
  return {
    sync,
    // After a local edit: mark the footer as waiting and sync a moment later (a burst of saves becomes one run).
    schedule() {
      if (disposed || !notesAccountId(store.get())) return;
      clearTimeout(timer);
      if (!store.get().noteSync.status.pending) setStatus({ pending: true });
      timer = setTimeout(() => { timer = null; sync().catch(() => {}); }, delay);
      timer.unref?.();
    },
    // Quitting: an edit still waiting (or a retry after a failed run) goes up now, within `limit` ms. A run already going
    // may have started before that edit, so the one queued after it is awaited too.
    async flush(limit = 3000) {
      if (disposed || (!timer && !running)) return;
      const queued = Boolean(timer);
      clearTimeout(timer); timer = null;
      const done = (async () => { if (queued) await sync().catch(() => {}); while (running) await running.catch(() => {}); })();
      let wait;
      await Promise.race([done, new Promise(resolve => { wait = setTimeout(resolve, limit); })]);
      clearTimeout(wait);
    },
    dispose() { disposed = true; clearTimeout(timer); },
  };
}

module.exports = { createNotesSync, sanitizeRemoteNote, readListing, recordNoteDeletion, driveClient, copyOf, copyId, sameContent, noteKey, noteRev, pastKey, deletionKey, laterThan, cleanPast, archiveText, mergePast, notesError, TOMBSTONE_DAYS, HISTORY, FILE_HISTORY, ANCESTORS, NOTE_ID, PAST };
