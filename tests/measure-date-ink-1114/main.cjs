'use strict';
// The measurement behind tests/overdue-red-1114.test.cjs's TITLE_EM, DATE_EM and DRAWN (2026-11-14): where the ink of a task's title and of
// the date line under it start, in the real renderer (renderer/index.html, app.js, styles.css, PretendardVariable.woff2) over a stand-in
// state, in the list, the right panel, the calendar's day panel and a tasks widget, at the three text sizes. Each row: the pens of both
// lines (Range rects), each first glyph's left side bearing (page.js: drawn at 500px on a canvas, its first column of half coverage), the
// ink difference, and a device-pixel cross-check from the captured frame. No store of the user's: userData and the store live in a fresh
// temp folder (set before ready), removed at the end; it is not Dayboard's main (no DAYBOARD_SMOKE_TEST, never the user's store), offscreen windows only.
// Run it by hand when the font, a title's or date line's size or weight, or the .task-text>.task-meta offset changes (the unit test's
// font hash and CSS fingerprint say when), with no other Electron running, from the folder that has node_modules:
//   MEASURE_OUT=<file.json> [MEASURE_SCALE=1.25] [DAYBOARD_ROOT=<worktree>] npx electron tests/measure-date-ink-1114/main.cjs
// then compare rows[].diff / penDiff / titleBearings / metaBearings with the test's tables. MEASURE_SCALE 1.25 is the 125% display check
// (a window zoom: offscreen windows draw one device px per DIP and ignore --force-device-scale-factor).
const { app, BrowserWindow, ipcMain } = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = process.env.DAYBOARD_ROOT || path.join(__dirname, '..', '..');
const DSF = process.env.MEASURE_DSF || '1';
const OUT = process.env.MEASURE_OUT;
if (!OUT) { console.error('MEASURE_OUT (a JSON file to write) is needed'); process.exit(2); }
const SCALE = Number(process.env.MEASURE_SCALE || 1); // the display scale, as a window zoom (offscreen windows draw at 1 device px per DIP)
app.commandLine.appendSwitch('force-device-scale-factor', DSF);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dayboard-measure-'));
app.setPath('userData', path.join(tmp, 'user'));
const { createStore } = require(path.join(ROOT, 'lib', 'store.cjs'));
const D = require(path.join(ROOT, 'renderer', 'domain.js'));

const today = D.dateKey();
const store = createStore(path.join(tmp, 'store'));
const titles = ['이사 준비', '보고서', '세금 내기', '우유', '장보기', '회의 준비', '병원', 'Report', '1차 회의'];
const dates = [D.dayOffset(today, -1), today, D.dayOffset(today, 1), D.dayOffset(today, 6), D.dayOffset(today, 20), D.dayOffset(today, 40), D.dayOffset(today, 3), D.dayOffset(today, 9), D.dayOffset(today, 2)];
store.mutate(state => {
  state.lists.push({ id: 'l1', name: '할 일', color: '#3478f6', provider: 'local' });
  titles.forEach((title, i) => state.tasks.push({ id: 't' + i, listId: 'l1', title, notes: '', dueDate: dates[i], completed: false, important: false, createdAt: new Date(Date.now() - i * 1000).toISOString(), ...(i === 3 ? { dueTime: '15:00' } : {}), ...(i === 5 ? { dueTime: '09:30' } : {}) }));
  // the right panel and the day panel on one day: three tasks there, one with a time, one with a subtask at a time
  for (const [i, title] of ['이사 준비', '보고서', '우유'].entries()) state.tasks.push({ id: 'd' + i, listId: 'l1', title, notes: '', dueDate: D.dayOffset(today, 5), completed: false, important: false, createdAt: new Date().toISOString(), ...(i === 1 ? { dueTime: '15:00' } : {}), ...(i === 2 ? { steps: [{ id: 's1', title: '두유', completed: false, dueDate: D.dayOffset(today, 5), dueTime: '10:00' }] } : {}) });
  Object.assign(state.settings, { language: 'ko', tourDone: true, theme: 'light', taskPanel: 'open', calendarPanel: 'open', sidebar: 'open', glassLevel: 1, widgetTheme: 'light' });
});
let state = { ...store.publicState(), app: { version: '0.0.0', update: null, backupFolder: '' } };
state.widgets = [{ id: 'w1', type: 'tasks', listId: 'l1', mode: 'desktop' }];
ipcMain.handle('measure:invoke', (_e, command, payload) => {
  if (command === 'state:get') return state;
  if (command === 'settings:update') { state = { ...state, settings: { ...state.settings, ...payload } }; return {}; }
  return {};
});

const LOG = m => fs.appendFileSync(OUT + '.probe', m + String.fromCharCode(10));
app.on('will-quit', () => LOG('will-quit'));
app.on('window-all-closed', () => {}); // between the windows the measuring goes on
process.on('exit', c => LOG('exit ' + c));
const PAGE = fs.readFileSync(path.join(__dirname, 'page.js'), 'utf8');
const wait = ms => new Promise(r => setTimeout(r, ms));

async function open(query, size) {
  const win = new BrowserWindow({ show: false, width: size[0], height: size[1], useContentSize: true, paintWhenInitiallyHidden: true, webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, sandbox: false, backgroundThrottling: false, offscreen: true } });
  win.webContents.setFrameRate(30);
  for (let n = 0; ; n++) { try { await win.loadFile(path.join(ROOT, 'renderer', 'index.html'), query ? { query } : undefined); break; } catch (e) { if (n >= 4) throw e; await wait(500); } }
  await win.webContents.executeJavaScript('document.fonts.ready.then(() => true)');
  await wait(600);
  return win;
}
// the bitmap of the page and how many device pixels a CSS px is
async function shot(win) { const img = await win.webContents.capturePage(); const s = img.getSize(); return { img, W: s.width, H: s.height, bmp: img.toBitmap() }; }

async function measureIn(win, js, label, zoom) {
  const info = await win.webContents.executeJavaScript(`(async () => { ${PAGE}; ${js} })()`);
  const p = await shot(win);
  const k = p.W / info.view; // device px per CSS px
  // the pixel check: from 6 CSS px left of a line's start, the first device column with ink (coverage of the text colour over the ground)
  const px = (x, y) => { const i = (y * p.W + x) * 4; return [p.bmp[i + 2], p.bmp[i + 1], p.bmp[i]]; }; // BGRA
  const lum = c => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  const firstInk = line => {
    if (!line) return null;
    const y0 = Math.ceil(line.top * k), y1 = Math.floor(line.bottom * k), x0 = Math.max(0, Math.floor((line.start - 6) * k)), x1 = Math.ceil((line.start + 8) * k);
    const ground = lum(px(x0, Math.round((y0 + y1) / 2))), ink = line.colorLum;
    for (let x = x0; x <= x1; x++) { let most = 0; for (let y = y0; y <= y1; y++) most = Math.max(most, Math.abs(lum(px(x, y)) - ground) / Math.max(1, Math.abs(ink - ground))); if (most >= 0.35) return +(x / k).toFixed(3); }
    return null;
  };
  for (const r of info.rows) { r.pixel = { title: firstInk(r.title), meta: firstInk(r.meta) }; r.pixel.diff = r.pixel.title != null && r.pixel.meta != null ? +(r.pixel.meta - r.pixel.title).toFixed(3) : null; }
  return { label, zoom, dsf: Number(DSF), k: +k.toFixed(4), ...info };
}

app.whenReady().then(async () => { LOG('ready');
  const results = [];
  try {
    for (const size of ['default', 'large', 'larger']) {
      state = { ...state, settings: { ...state.settings, textSize: size } };
      const zoom = D.textScale(size) * SCALE;
      LOG('open ' + size); const win = await open(null, [Math.round(1400 * zoom), Math.round(900 * zoom)]); LOG('opened');
      win.webContents.setZoomFactor(zoom); await wait(500);
      results.push(await measureIn(win, `goto('l1'); render(); await new Promise(r => setTimeout(r, 300)); return measure('#app .tasks-view');`, 'list', zoom));
      results.push(await measureIn(win, `goto('l1'); selectedDate = ${JSON.stringify(D.dayOffset(today, 5))}; render(); await new Promise(r => setTimeout(r, 300)); return measure('#app .context-pane');`, 'right-panel', zoom));
      results.push(await measureIn(win, `goto('calendar'); selectedDate = ${JSON.stringify(D.dayOffset(today, 5))}; render(); await new Promise(r => setTimeout(r, 400)); return measure('#app .day-panel');`, 'day-panel', zoom));
      win.destroy();
    }
    for (const size of ['default', 'large', 'larger']) {
      state = { ...state, settings: { ...state.settings, widgetTextSize: size } };
      const win = await open({ widget: 'tasks', id: 'w1' }, [Math.round(360 * SCALE * D.textScale(size)), Math.round(620 * SCALE * D.textScale(size))]);
      win.webContents.setZoomFactor(SCALE); await wait(500);
      results.push(await measureIn(win, `render(); await new Promise(r => setTimeout(r, 300)); return measure('#app .widget-tasks');`, 'widget', D.textScale(size) * SCALE));
      win.destroy();
    }
  } catch (error) { results.push({ error: String(error && error.stack || error) }); }
  fs.writeFileSync(OUT, JSON.stringify(results, null, 1));
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
  app.exit(0);
});
