'use strict';
// shortcut-sheet-one-line — every row of the shortcut sheet (? → 키보드 단축키, renderer/help.js shortcutGroups, two .shortcut-col
// columns) on one line (2026-11-12: in English three descriptions wrapped, one word alone on the second line, at 1180 and 900 wide —
// 「Show or hide all subtasks」, 「Scroll the hours in week and day views」, 「Next / previous match」. renderer/i18n.js now has
// 「Expand or collapse all」 — the verbs and 「or」 of the row under it, 「Expand or collapse subtasks」, after 「Show/hide all subtasks」 (2026-11-12
// lead) —, 「Scroll the hours (week, day)」, 「Next/previous match」, the Korean unchanged). Korean and English,
// 기본 · 크게 · 더 크게, 1180×780 and 900×650: a description's lines are the distinct tops of its text's client rects (not scrollHeight),
// the keys' line the distinct tops of their caps. The room each description has left (its row less the keys and the gap, less its text
// unwrapped) is written per row: the sheet's column is 281 CSS px at every text size (the whole page is zoomed), so the room is the same
// at 크게 and 더 크게; 더 크게 at 900 wide is 720 CSS px and stacks the columns. Pictures: the sheet ×2 and the three rows ×3 (with the
// rows above and below) in output/sheet-lines-1112/, and sheet-lines.json.
// go-to-date-sentence-case — 「날짜로 이동」 in English reads 「Go to date」 (was Apple Calendar's 「Go to Date」 among sentence-case labels, 2026-11-12
// lead) in all four places it is said: the calendar title's tooltip, the dialog it opens, the sheet's row and the calendar's ? card; pictures of
// the dialog and the card (go-to-date-*.png).
// help-card-one-line — every row of the ? card (helpOpen: renderer/help.js usefulShortcuts, then 「모든 키보드 단축키」 and 「기능 둘러보기」) on
// one line beside its keys by the same rule (broken), on the tasks, calendar and notes screens, Korean and English, 1180×780 and 900×650,
// 기본 글자 (2026-11-12 lead: in English the calendar's 「Day, week, month view」 left 「view」 alone on a second line in the card's 276px; now
// 「Day, week, month」). The card is 276 CSS px at any window, so 900 checks only that the card still opens there. The room is the row's
// content box less the keys and the gap. Pictures: each card ×2 (card-<lang>-<width>-<screen>-x2.png) and card-lines.json.
// shortcut-sheet-globe — the 어디서나 heading draws the globe (paths.globe, tests/globe-icon-1112.test.cjs; the keyboard read as a face with
// many eyes, 2026-11-12 owner), the four headings globe · tasks · calendar · note at 16 CSS px. Pictures at 1180×780, ko and en, light and
// dark: the sheet ×1 (sheet-<lang>-<theme>-1180-x1.png) and the four headings ×3 (heading-<lang>-<theme>-<n>-x3.png).
// Called by tests/ui-smoke.cjs (its last screen block, before the pointer guard's check; DAYBOARD_SMOKE_ONLY=sheet-lines runs it alone);
// returns the passed check names, throws on the first failure.
const fs = require('node:fs');
const path = require('node:path');

// The three rows that wrapped in English, by their Korean keys (help.js; the label drawn is tr(key) in either language).
const WATCH = ['하위 할 일 모두 펼치기·접기', '주간·일간에서 시간 이동', '다음·이전 찾기'];
const SLUG = ['all-subtasks', 'scroll-hours', 'next-previous-match'];
// A row that does not sit on one line beside its keys: its description on two lines, its keys on two, or its description wider than the room
// it has (slack < 0) — a word that cannot break runs over the keys on one line (the description is min-width:0 in the flex row), which the
// line count alone missed (2026-11-12 review).
const broken = r => r.lines !== 1 || r.keyLines !== 1 || !(r.slack >= 0);

module.exports = async function sheetLines({ mainWindow, invoke, output, run, settle, expect, calm }) {
  const checks = [];
  const dir = path.join(output, 'sheet-lines-1112');
  fs.mkdirSync(dir, { recursive: true });
  const { capture, crop } = require('./ui-smoke-head-keys-1112.cjs').pixels(mainWindow, dir);
  const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
  const bounds = mainWindow.getBounds();
  const away = () => mainWindow.webContents.sendInputEvent({ type: 'mouseMove', x: 760, y: 420 });
  const still = async () => { await settle(mainWindow); await calm(mainWindow); await pause(120); await settle(mainWindow); };
  const scenes = [];
  const goDate = {};
  const cards = [];
  const heads = [];
  try {
    for (const language of ['ko', 'en']) for (const textSize of ['default', 'large', 'larger']) for (const [w, hgt] of [[1180, 780], [900, 650]]) {
      await invoke('settings:update', { language, theme: 'light', textSize });
      mainWindow.setSize(w, hgt); away();
      await run(mainWindow, `closeModal?.(true); goto('today'); openShortcuts(); return true;`);
      await still();
      const tag = `${language}-${textSize}-${w}`;
      const m = await run(mainWindow, `
        const R = n => { const r = n.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom }; };
        const r2 = v => Math.round(v * 100) / 100;
        const textRects = n => { const g = document.createRange(); g.selectNodeContents(n); return [...g.getClientRects()].filter(x => x.width > 1); };
        const lines = n => new Set(textRects(n).map(x => Math.round(x.top))).size;
        // the description's width on one line: white-space nowrap for the measure, then back
        const natural = n => { const was = n.style.whiteSpace; n.style.whiteSpace = 'nowrap'; const g = document.createRange(); g.selectNodeContents(n); const width = g.getBoundingClientRect().width; n.style.whiteSpace = was; return width; };
        const dialog = document.querySelector('#modal-root .dialog'), body = dialog.querySelector('.shortcuts-body');
        const rows = [...body.querySelectorAll('.shortcut-row')].map(row => {
          const dt = row.querySelector('dt'), dd = row.querySelector('dd'), r = row.getBoundingClientRect(), keys = dd.getBoundingClientRect();
          const room = r.width - keys.width - parseFloat(getComputedStyle(row).columnGap || '0');
          return { group: row.closest('.shortcut-group').querySelector('h3').textContent, label: dt.textContent, lines: lines(dt),
            keyLines: new Set([...dd.querySelectorAll('kbd')].map(k => Math.round(k.getBoundingClientRect().top))).size,
            room: r2(room), slack: r2(room - natural(dt)), h: r2(r.height) };
        });
        return { view: innerWidth, lang: document.documentElement.lang, expected: shortcutGroups().reduce((n, [, list]) => n + list.length, 0), cols: getComputedStyle(body).gridTemplateColumns, sheet: R(dialog),
          scroll: r2(dialog.scrollHeight - dialog.clientHeight), rows,
          watch: ${JSON.stringify(WATCH)}.map(key => tr(key)) };`);
      // the sheet as it opens (×2), then each watched row with its neighbours (×3), scrolled into the sheet's view first
      let p = await capture(m.view);
      crop(p, m.sheet, `sheet-${tag}-x2`, 2);
      for (const i of WATCH.keys()) {
        const box = await run(mainWindow, `
          const row = [...document.querySelectorAll('#modal-root .shortcut-row')].find(n => n.querySelector('dt').textContent === ${JSON.stringify(m.watch[i])});
          if (!row) return null;
          row.scrollIntoView({ block: 'nearest' });
          const a = (row.previousElementSibling || row).getBoundingClientRect(), b = (row.nextElementSibling || row).getBoundingClientRect(), r = row.getBoundingClientRect();
          return { l: r.left - 8, t: a.top - 4, r: r.right + 8, b: b.bottom + 4 };`);
        if (!box) continue;
        await still();
        p = await capture(m.view);
        crop(p, box, `row-${tag}-${SLUG[i]}-x3`, 3);
      }
      await run(mainWindow, `closeModal(true); return true;`); await still();
      scenes.push({ tag, view: m.view, read: `${m.rows.length}/${m.expected}`, k: Math.round(p.k * 1000) / 1000, lang: m.lang, cols: m.cols, scroll: m.scroll,
        wrapped: m.rows.filter(broken).map(r => `${r.label} (${r.lines}/${r.keyLines}/${r.slack})`),
        tightest: m.rows.slice().sort((a, b) => a.slack - b.slack).slice(0, 4).map(r => `${r.label}: ${r.slack}`),
        watched: m.watch.map(label => m.rows.find(r => r.label === label)).filter(Boolean).map(r => ({ label: r.label, lines: r.lines, room: r.room, slack: r.slack })),
        rows: m.rows });
    }
    // The ? card on each screen: every row (its useful shortcuts, then its two links) on one line beside its keys, 기본 글자
    for (const language of ['ko', 'en']) {
      await invoke('settings:update', { language, theme: 'light', textSize: 'default' });
      for (const [w, hgt] of [[1180, 780], [900, 650]]) for (const screen of ['today', 'calendar', 'notes']) {
        mainWindow.setSize(w, hgt); away();
        await run(mainWindow, `closeModal?.(true); helpClose(); goto(${JSON.stringify(screen)}); return true;`); await still();
        // the resting pointer's rounded tip (a calendar day's, app.js tipHide) is left on <body> when the screen changes under it: not in the pictures
        await run(mainWindow, `tipHide(); helpOpen(true); return true;`); await still();
        const tag = `${language}-${w}-${screen === 'today' ? 'tasks' : screen}`;
        const m = await run(mainWindow, `
          const r2 = v => Math.round(v * 100) / 100;
          const textRects = n => { const g = document.createRange(); g.selectNodeContents(n); return [...g.getClientRects()].filter(x => x.width > 1); };
          const lines = n => new Set(textRects(n).map(x => Math.round(x.top))).size;
          const natural = n => { const was = n.style.whiteSpace; n.style.whiteSpace = 'nowrap'; const g = document.createRange(); g.selectNodeContents(n); const width = g.getBoundingClientRect().width; n.style.whiteSpace = was; return width; };
          const card = document.querySelector('.help-pop');
          if (!card) return { view: innerWidth, lang: document.documentElement.lang, rows: [], expected: usefulShortcuts().length + 2, box: null };
          const rows = [...card.querySelectorAll('.help-rows li, .help-link')].map(row => {
            const label = row.querySelector(':scope > span:not(.keys)'), keys = row.querySelector(':scope > .keys'), cs = getComputedStyle(row), r = row.getBoundingClientRect();
            const inner = r.width - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight) - parseFloat(cs.borderLeftWidth) - parseFloat(cs.borderRightWidth);
            const room = inner - (keys ? keys.getBoundingClientRect().width + parseFloat(cs.columnGap || '0') : 0);
            return { kind: row.tagName === 'LI' ? 'row' : 'link', label: label.textContent, lines: lines(label),
              keyLines: keys ? new Set([...keys.querySelectorAll('kbd')].map(k => Math.round(k.getBoundingClientRect().top))).size : 1,
              room: r2(room), slack: r2(room - natural(label)), h: r2(r.height) };
          });
          const b = card.getBoundingClientRect();
          return { view: innerWidth, lang: document.documentElement.lang, rows, expected: usefulShortcuts().length + 2, width: r2(b.width),
            box: { l: b.left - 12, t: b.top - 12, r: b.right + 12, b: b.bottom + 12 } };`);
        if (m.box) crop(await capture(m.view), m.box, `card-${tag}-x2`, 2);
        await run(mainWindow, `helpClose(); return true;`); await still();
        cards.push({ tag, lang: m.lang, width: m.width ?? null, read: `${m.rows.length}/${m.expected}`,
          wrapped: m.rows.filter(broken).map(r => `${r.label} (${r.lines}/${r.keyLines}/${r.slack})`),
          tightest: m.rows.slice().sort((a, b) => a.slack - b.slack).slice(0, 3).map(r => `${r.label}: ${r.slack}`), rows: m.rows });
      }
    }
    // The four headings of the sheet at 1180: globe · tasks · calendar · note, light and dark, ko and en, with pictures
    for (const language of ['ko', 'en']) for (const theme of ['light', 'dark']) {
      await invoke('settings:update', { language, theme, textSize: 'default' });
      mainWindow.setSize(1180, 780); away();
      await run(mainWindow, `closeModal?.(true); helpClose(); tipHide(); goto('today'); openShortcuts(); return true;`); await still();
      const m = await run(mainWindow, `
        tipHide();
        const R = (n, pad) => { const r = n.getBoundingClientRect(); return { l: r.left - pad, t: r.top - pad, r: r.right + pad, b: r.bottom + pad }; };
        const dialog = document.querySelector('#modal-root .dialog');
        if (!dialog) return null;
        const h3 = [...dialog.querySelectorAll('.shortcut-group > h3')];
        return { view: innerWidth, sheet: R(dialog, 16), heads: h3.map(n => { const svg = n.querySelector('svg'), s = svg?.getBoundingClientRect();
          return { title: n.textContent.trim(), icon: svg?.getAttribute('data-icon') ?? null, size: s ? [Math.round(s.width * 100) / 100, Math.round(s.height * 100) / 100].join('x') : null, drawn: Boolean(svg) && svg.querySelector('path')?.getAttribute('d') === paths[svg.getAttribute('data-icon')], parts: svg ? svg.querySelectorAll('path').length : 0, box: R(n, 4) }; }) };`);
      if (m) {
        const p = await capture(m.view);
        crop(p, m.sheet, `sheet-${language}-${theme}-1180-x1`, 1);
        m.heads.forEach((head, i) => crop(p, head.box, `heading-${language}-${theme}-${i + 1}-x3`, 3));
      }
      await run(mainWindow, `closeModal(true); return true;`); await still();
      heads.push({ tag: `${language}-${theme}`, heads: m ? m.heads.map(({ box, ...head }) => head) : null });
    }
    await invoke('settings:update', { language: 'ko', theme: 'light', textSize: 'default' });
    // 「날짜로 이동」 in English at 1180: the calendar title's tooltip, its dialog's title, the sheet's row, the calendar's ? card
    await invoke('settings:update', { language: 'en', theme: 'light', textSize: 'default' });
    mainWindow.setSize(1180, 780); away();
    await run(mainWindow, `closeModal?.(true); goto('calendar'); return true;`); await still();
    goDate.tooltip = await run(mainWindow, `return document.querySelector('#app .title-button')?.title ?? null;`);
    await run(mainWindow, `calGoToDate(); return true;`); await still();
    const R = `const R = n => { const r = n.getBoundingClientRect(); return { l: r.left - 12, t: r.top - 12, r: r.right + 12, b: r.bottom + 12 }; };`;
    const dialog = await run(mainWindow, `${R} const d = document.querySelector('#modal-root .dialog'); return d ? { title: d.querySelector('#dialog-title')?.textContent ?? null, box: R(d), view: innerWidth } : null;`);
    goDate.dialog = dialog?.title ?? null;
    if (dialog) crop(await capture(dialog.view), dialog.box, 'go-to-date-dialog-en-1180-x2', 2);
    await run(mainWindow, `closeModal(true); openShortcuts(); return true;`); await still();
    goDate.sheet = await run(mainWindow, `return [...document.querySelectorAll('#modal-root .shortcut-group')].find(g => g.querySelector('h3')?.textContent.trim() === tr('달력'))?.querySelectorAll('.shortcut-row dt')[1]?.textContent ?? null;`);
    await run(mainWindow, `closeModal(true); return true;`); await still();
    await run(mainWindow, `helpOpen(true); return true;`); await still();
    const card = await run(mainWindow, `${R} const c = document.querySelector('.help-pop'); return c ? { row: c.querySelectorAll('.help-rows li > span:first-child')[1]?.textContent ?? null, box: R(c), view: innerWidth } : null;`);
    goDate.card = card?.row ?? null;
    if (card) crop(await capture(card.view), card.box, 'go-to-date-card-en-1180-x2', 2);
    await run(mainWindow, `helpClose(); return true;`); await still();
  } finally {
    await run(mainWindow, `closeModal?.(true); goto('today'); return true;`).catch(() => {});
    await invoke('settings:update', { language: 'ko', theme: 'light', textSize: 'default' }).catch(() => {});
    mainWindow.setBounds(bounds); await still();
  }
  fs.writeFileSync(path.join(dir, 'sheet-lines.json'), JSON.stringify(scenes, null, 1));
  fs.writeFileSync(path.join(dir, 'go-to-date.json'), JSON.stringify(goDate, null, 1));
  fs.writeFileSync(path.join(dir, 'card-lines.json'), JSON.stringify(cards, null, 1));
  fs.writeFileSync(path.join(dir, 'headings.json'), JSON.stringify(heads, null, 1));
  // Every scene — both languages, every text size, both windows: no description and no keys on a second line, no description wider than its
  // room; every row of the sheet read.
  const oneLine = s => s.rows.length > 0 && s.read === `${s.rows.length}/${s.rows.length}` && s.wrapped.length === 0 && s.lang === s.tag.slice(0, 2);
  const summary = scenes.map(({ rows, ...s }) => s);
  expect(scenes.length === 12 && scenes.every(oneLine), `단축키 표 한 줄 ${JSON.stringify(summary)}`);
  checks.push('shortcut-sheet-one-line');
  expect(goDate.tooltip === 'Go to date (G)' && goDate.dialog === 'Go to date' && goDate.sheet === 'Go to date' && goDate.card === 'Go to date', `날짜로 이동 영어 ${JSON.stringify(goDate)}`);
  checks.push('go-to-date-sentence-case');
  // Every ? card — tasks, calendar, notes; ko and en; 1180 and 900: opened, every row read, none broken, 276px wide
  const cardOk = c => c.read === `${c.rows.length}/${c.rows.length}` && c.rows.length >= 5 && c.wrapped.length === 0 && c.lang === c.tag.slice(0, 2) && c.width === 276;
  expect(cards.length === 12 && cards.every(cardOk), `? 카드 한 줄 ${JSON.stringify(cards.map(({ rows, ...c }) => c))}`);
  checks.push('help-card-one-line');
  // drawn: the svg's outline is paths[its data-icon] (icon() falls back to the list's for a name it lacks); the globe is one stroked path, no fills
  const four = h => h.heads && h.heads.map(x => x.icon).join(',') === 'globe,tasks,calendar,note' && h.heads.every(x => x.size === '16x16' && x.drawn) && h.heads[0].parts === 1;
  expect(heads.length === 4 && heads.every(four), `단축키 표 머리 아이콘 ${JSON.stringify(heads)}`);
  checks.push('shortcut-sheet-globe');
  return checks;
};
module.exports.broken = broken;
