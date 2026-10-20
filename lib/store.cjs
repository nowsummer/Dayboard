'use strict';
const { tr } = require('./i18n.cjs');

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const COLLECTIONS = ['lists', 'tasks', 'calendars', 'events', 'notes', 'accounts', 'widgets', 'groups'];
const PUBLIC_FIELDS = {
  lists: ['id', 'name', 'color', 'provider', 'accountId', 'remoteId', 'groupId', 'icon', 'kind'],
  groups: ['id', 'name', 'collapsed'],
  tasks: ['id', 'listId', 'title', 'notes', 'dueDate', 'reminderAt', 'important', 'completed', 'createdAt', 'updatedAt', 'remoteId', 'syncStatus'],
  calendars: ['id', 'name', 'color', 'customColor', 'provider', 'accountId', 'remoteId', 'readOnly', 'primary'],
  events: ['id', 'calendarId', 'title', 'start', 'end', 'allDay', 'location', 'color', 'rrule', 'exdates', 'masterId', 'recurrenceId', 'recurring', 'provider', 'accountId', 'remoteId'],
  notes: ['id', 'title', 'body', 'color', 'updatedAt'],
  accounts: ['id', 'provider', 'name', 'status', 'lastSync', 'error', 'syncTasks', 'syncCalendar', 'calendarWrite'],
  widgets: ['id', 'type', 'listId', 'noteId', 'mode', 'bounds', 'desktopStatus', 'desktopMessage', 'backdrop']
};

function initialState() {
  return {
    version: 1,
    lists: [{ id: 'local-inbox', name: tr('내 할 일'), color: '#3478f6', provider: 'local' }],
    tasks: [],
    calendars: [{ id: 'local-calendar', name: tr('개인 일정'), color: '#ff6b57', provider: 'local' }],
    events: [], notes: [], accounts: [], widgets: [], groups: [],
    // Colour of a whole repeating series on a connected calendar, chosen on this PC ("<calendarId>:<seriesId>" → #rrggbb).
    // Applied to the series' instances as they arrive from a sync. Internal (the renderer sees the colours on the events).
    seriesColors: {},
    settings: { theme: 'light', widgetOpacity: 0.94, widgetMode: 'desktop', launchAtLogin: false, collapsedSections: [], defaultListId: null, defaultCalendarId: null, listOrder: [], timeFormat: '12h', language: 'system', hiddenCalendars: [], hiddenSections: [], hiddenLists: [], glassLevel: 0.5, autoUpdate: true },
    sync: { busy: false, lastSync: null, error: null }
  };
}

// Files written by earlier builds predate some collections; add them before validating.
function migrate(raw) {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    if (!Array.isArray(raw.groups)) raw.groups = [];
    if (!raw.seriesColors || typeof raw.seriesColors !== 'object' || Array.isArray(raw.seriesColors)) raw.seriesColors = {};
  }
  return raw;
}

function validateState(state) {
  if (!state || typeof state !== 'object' || Array.isArray(state) || state.version !== 1) {
    throw new Error(tr('지원하지 않는 데이터 형식입니다. 원본 데이터를 보존했습니다.'));
  }
  for (const key of COLLECTIONS) {
    if (!Array.isArray(state[key])) throw new Error(tr("저장된 {0} 데이터 형식이 올바르지 않습니다.", [key]));
    const seen = new Set();
    for (const item of state[key]) {
      if (!item || typeof item !== 'object' || Array.isArray(item) || typeof item.id !== 'string' || !item.id || seen.has(item.id)) {
        throw new Error(tr("저장된 {0} 항목의 ID가 없거나 중복되었습니다.", [key]));
      }
      seen.add(item.id);
    }
  }
  if (!state.settings || typeof state.settings !== 'object' || Array.isArray(state.settings)) throw new Error(tr('설정 데이터 형식이 올바르지 않습니다.'));
  if (!state.sync || typeof state.sync !== 'object' || Array.isArray(state.sync)) state.sync = initialState().sync;
  if (!state.seriesColors || typeof state.seriesColors !== 'object' || Array.isArray(state.seriesColors) || Object.entries(state.seriesColors).some(([key, value]) => typeof key !== 'string' || !/^#[\da-f]{6}$/i.test(String(value)))) throw new Error(tr('저장된 반복 일정 색 설정이 올바르지 않습니다.'));
  // glassLevel replaced the always-on-top opacity slider (2026-10-20): a changed old opacity carries over.
  if (!Object.hasOwn(state.settings, 'glassLevel') && Number.isFinite(state.settings.widgetOpacity) && state.settings.widgetOpacity !== 0.94) {
    // Inverse of glassTint's always-on-top alpha (0.78 at level 0, 0.94 at 0.5, 1 at 1).
    const op = state.settings.widgetOpacity;
    const level = op <= 0.94 ? (op - 0.78) / 0.32 : 0.5 + (op - 0.94) / 0.12;
    state.settings.glassLevel = Math.round(Math.min(1, Math.max(0, level)) * 100) / 100;
  }
  state.settings = { ...initialState().settings, ...state.settings };
  if (!['light', 'dark', 'system'].includes(state.settings.theme)
      || !['desktop', 'top'].includes(state.settings.widgetMode)
      || typeof state.settings.launchAtLogin !== 'boolean'
      || typeof state.settings.autoUpdate !== 'boolean'
      || !Number.isFinite(state.settings.widgetOpacity) || state.settings.widgetOpacity < 0.5 || state.settings.widgetOpacity > 1) {
    throw new Error(tr('저장된 설정 값이 올바르지 않습니다.'));
  }
  if (!Array.isArray(state.settings.collapsedSections) || state.settings.collapsedSections.some(item => typeof item !== 'string')) throw new Error(tr('저장된 사이드바 상태가 올바르지 않습니다.'));
  if (!Array.isArray(state.settings.listOrder) || state.settings.listOrder.some(item => typeof item !== 'string')) throw new Error(tr('저장된 목록 순서가 올바르지 않습니다.'));
  if (!Array.isArray(state.settings.hiddenCalendars) || state.settings.hiddenCalendars.some(item => typeof item !== 'string')) throw new Error(tr('저장된 달력 표시 설정이 올바르지 않습니다.'));
  if (!Array.isArray(state.settings.hiddenSections) || state.settings.hiddenSections.some(item => typeof item !== 'string')) throw new Error(tr('저장된 계정 표시 설정이 올바르지 않습니다.'));
  if (!Array.isArray(state.settings.hiddenLists) || state.settings.hiddenLists.some(item => typeof item !== 'string')) throw new Error(tr('저장된 목록 표시 설정이 올바르지 않습니다.'));
  if (typeof state.settings.glassLevel !== 'number' || !Number.isFinite(state.settings.glassLevel) || state.settings.glassLevel < 0 || state.settings.glassLevel > 1) throw new Error(tr('저장된 유리 효과 설정이 올바르지 않습니다.'));
  if (state.settings.defaultListId !== null && typeof state.settings.defaultListId !== 'string') throw new Error(tr('저장된 기본 목록 설정이 올바르지 않습니다.'));
  if (state.settings.defaultCalendarId !== null && typeof state.settings.defaultCalendarId !== 'string') throw new Error(tr('저장된 기본 달력 설정이 올바르지 않습니다.'));
  if (!['12h', '24h'].includes(state.settings.timeFormat) || !['system', 'ko', 'en'].includes(state.settings.language)) throw new Error(tr('저장된 표시 설정이 올바르지 않습니다.'));
  for (const widget of state.widgets) {
    if (!['tasks', 'calendar', 'note'].includes(widget.type) || !['desktop', 'top'].includes(widget.mode)) throw new Error(tr('저장된 위젯 형식이 올바르지 않습니다.'));
    if (widget.bounds && !['x', 'y', 'width', 'height'].every(key => Number.isFinite(widget.bounds[key]))) throw new Error(tr('저장된 위젯 위치가 올바르지 않습니다.'));
    // homeBounds (internal): the widget's own place on a screen that is not connected right now.
    if (widget.homeBounds && !['x', 'y', 'width', 'height'].every(key => Number.isFinite(widget.homeBounds?.[key]))) delete widget.homeBounds;
  }
  return state;
}

// Keep an existing same-PC directory in place: Windows-encrypted credentials
// belong to that profile, and source-folder renaming must not hide local data.
function resolveUserDataDirectory(preferred, candidates = []) {
  const hasData = directory => ['dayboard.json', 'dayboard.previous.json', 'daylight.json', 'daylight.previous.json', 'cloud-credentials.bin'].some(name => fs.existsSync(path.join(directory, name)));
  if (hasData(preferred)) return preferred;
  const found = [...new Set(candidates.map(value => path.resolve(value)))].filter(value => path.resolve(preferred).toLowerCase() !== value.toLowerCase() && hasData(value));
  if (found.length > 1) throw new Error(tr("이 PC에 기존 Daylight 데이터 폴더가 여러 개 있습니다. 원본을 모두 보존했습니다. 사용할 폴더를 확인해 주세요: {0}", [found.join(', ')]));
  return found[0] || preferred;
}

function createStore(directory) {
  fs.mkdirSync(directory, { recursive: true });
  const file = path.join(directory, 'dayboard.json');
  const backup = path.join(directory, 'dayboard.previous.json');
  const legacy = path.join(directory, 'daylight.json');
  const legacyBackup = path.join(directory, 'daylight.previous.json');
  let state;
  let recoveredPrimary = false;
  const source = fs.existsSync(file) ? file : fs.existsSync(backup) ? backup : fs.existsSync(legacy) ? legacy : fs.existsSync(legacyBackup) ? legacyBackup : null;
  if (source) {
    try { state = validateState(migrate(JSON.parse(fs.readFileSync(source, 'utf8')))); }
    catch (originalError) {
      // Do not overwrite a corrupt source or silently create an empty account.
      try {
        const recoverySource = source === legacy ? legacyBackup : backup;
        if (source === recoverySource) throw originalError;
        state = validateState(migrate(JSON.parse(fs.readFileSync(recoverySource, 'utf8'))));
        fs.copyFileSync(source, path.join(directory, `dayboard.recovery-${Date.now()}-${crypto.randomUUID()}.json`), fs.constants.COPYFILE_EXCL);
        recoveredPrimary = source === file;
        state.sync.error = tr('이전 저장본에서 데이터를 복구했습니다. 손상된 파일은 별도로 보존했습니다.');
      } catch { throw new Error(tr("Dayboard 데이터를 열 수 없습니다. {0}의 파일을 보존했습니다. {1}", [directory, originalError.message])); }
    }
  } else state = initialState();
  state.sync.busy = false;

  // Windows Search or antivirus may hold a just-written file for a moment; a
  // transient EPERM/EBUSY must not reject the user's edit with a raw Node error.
  function withRetry(operation, label) {
    const pause = ms => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
    for (let attempt = 0; ; attempt++) {
      try { return operation(); }
      catch (error) {
        if (attempt >= 5 || !['EPERM', 'EBUSY', 'EACCES'].includes(error.code)) {
          const wrapped = new Error(`${label} (${error.code || error.message})`);
          wrapped.cause = error;
          throw wrapped;
        }
        pause(40 * (attempt + 1));
      }
    }
  }
  function persist(candidate) {
    validateState(candidate);
    const temp = `${file}.${crypto.randomUUID()}.tmp`;
    let descriptor;
    try {
      descriptor = fs.openSync(temp, 'wx', 0o600);
      fs.writeFileSync(descriptor, JSON.stringify(candidate, null, 2), 'utf8');
      fs.fsyncSync(descriptor);
      fs.closeSync(descriptor);
      descriptor = undefined;
      // A recovered primary still contains corrupt bytes. Retain the known-good
      // backup until the primary has successfully been atomically replaced.
      if (fs.existsSync(file) && !recoveredPrimary) withRetry(() => fs.copyFileSync(file, backup), tr('이전 저장본을 만들지 못했습니다. 잠시 후 다시 시도해 주세요.'));
      withRetry(() => fs.renameSync(temp, file), tr('Dayboard 데이터 파일을 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.'));
      recoveredPrimary = false;
    } finally {
      if (descriptor !== undefined) fs.closeSync(descriptor);
      if (fs.existsSync(temp)) fs.unlinkSync(temp);
    }
  }
  // Heal a recovered primary right away; otherwise every read-only launch would
  // re-recover and add another copy of the corrupt file.
  if (!fs.existsSync(file) || recoveredPrimary) persist(state);

  return {
    get() { return structuredClone(state); },
    mutate(fn) {
      const next = structuredClone(state);
      const result = fn(next);
      if (result && typeof result.then === 'function') throw new Error(tr('비동기 변경은 저장할 수 없습니다. 변경 완료 후 저장해 주세요.'));
      persist(next);
      state = next;
      return structuredClone(state);
    },
    save() { persist(state); },
    publicState() {
      const result = { version: state.version };
      for (const key of COLLECTIONS) result[key] = state[key].map(item => {
        const selected = {};
        for (const field of PUBLIC_FIELDS[key]) if (Object.hasOwn(item, field)) selected[field] = item[field];
        if (key === 'widgets' && selected.bounds) selected.bounds = Object.fromEntries(['x', 'y', 'width', 'height'].map(field => [field, selected.bounds[field]]));
        return structuredClone(selected);
      });
      result.settings = {
        theme: state.settings.theme,
        widgetOpacity: state.settings.widgetOpacity,
        widgetMode: state.settings.widgetMode,
        launchAtLogin: state.settings.launchAtLogin,
        autoUpdate: state.settings.autoUpdate,
        collapsedSections: [...state.settings.collapsedSections],
        defaultListId: state.settings.defaultListId,
        defaultCalendarId: state.settings.defaultCalendarId,
        listOrder: [...state.settings.listOrder],
        hiddenCalendars: [...state.settings.hiddenCalendars],
        hiddenSections: [...state.settings.hiddenSections],
        hiddenLists: [...state.settings.hiddenLists],
        glassLevel: state.settings.glassLevel,
        timeFormat: state.settings.timeFormat,
        language: state.settings.language
      };
      result.sync = { busy: Boolean(state.sync.busy), lastSync: state.sync.lastSync || null, error: state.sync.error || null };
      return result;
    }
  };
}

module.exports = { createStore, initialState, validateState, resolveUserDataDirectory };
