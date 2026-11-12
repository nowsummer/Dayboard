'use strict';
// Two owner requests of 2026-11-12, checked in the running app by the pixels it draws (the way the owner looks at a crop), not by the DOM alone.
// sidebar-head-on-rhythm — 「나의 목록」 over its lists (owner's crop of the heading and 업무 · 할 일 · 학업 · 쇼핑 리스트): its buttons were 26px with
//   20px icons and the space under it read apart from the rows' own. Now (styles.css, the 「나의 목록」 block before r60-apple; the CSS in
//   tests/text-size-1110.test.cjs) the white from the word's ink to the first circle equals the white between the circles; from the word to the
//   first name and from the heading's icons to the first count is no larger than between the rows; the tiles above stay at least twice as far;
//   the + stands on the rows' ⋯; a selected or hovered first row's fill leaves white under the heading. Light and dark at 1180×780, 크게 and
//   더 크게 (a device pixel of rounding at each gap there), a group first, and a sidebar that scrolls. Crops ×3 in output/head-keys-1112/.
// shortcuts-mouse-cap — 더블클릭 in the shortcut sheet (owner: 「다른건 키보드 느낌인데 더블클릭은 그냥 적혀 있어서 이상해. 다른 것과 마찬가지로
//   만들어줘.」): one key cap holding its words, drawn exactly as the keys (every computed property of the cap), on one line, inside its row and
//   centred on it, Korean and English (「Double-click」), light and dark, at 1180×780 and 900×650; the ? card's caps are the sheet's. Pictures
//   of the sheet and the card in each, and the row ×3.
// sidebar-chosen-at-foot — the list chosen last in the sidebar stops clear of the 20px fade at its foot (V20), by the pixels. A check of the
//   24px buttons (2026-11-12) found it under the fade at 900×780 더 크게 (ui-smoke subtasks-narrow): the sidebar 2px shorter, app.js
//   sidebarKeepChosen went to the whole scrollHeight − clientHeight while the true end at ×1.25 is fractional, so the scroll stopped 0.8 CSS px
//   short, scroll-state(scrollable: bottom) held and the fade lay over the row's lower half. Now it reads the true end (scrollTop set to
//   scrollHeight and read back) and goes there. 1180×780 chosen, then 크게 or 더 크게 and 900×780, the way that scene got there, with one to four lists more.
// Called by tests/ui-smoke.cjs (its last block; DAYBOARD_SMOKE_ONLY=head-keys runs it alone); returns the passed check names, throws on the first failure.
// chosenAtFoot and footOk are also used by ui-smoke.cjs's subtasks-narrow scene.
const fs = require('node:fs');
const path = require('node:path');
const { nativeImage } = require('electron');

// ---- pixels: the whole window drawn (a clip is drawn again on its own grid), k device px a CSS px ----
function pixels(mainWindow, dir) {
  const capture = async view => {
    const img = await mainWindow.webContents.capturePage(), { width: W, height: H } = img.getSize();
    return { img, W, H, k: W / view, bmp: img.toBitmap() };
  };
  const rgb = (p, x, y) => { const i = (Math.min(p.H - 1, Math.max(0, y)) * p.W + Math.min(p.W - 1, Math.max(0, x))) * 4; return [p.bmp[i + 2], p.bmp[i + 1], p.bmp[i]]; };
  const gap = (a, b) => Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]), Math.abs(a[2] - b[2]));
  const differs = (a, b, th) => gap(a, b) > th;
  // Device rows, inside a CSS rect (2px of slack above and below), where any pixel stands out from the ground by more than th.
  const ink = (p, bg, r, th = 40) => {
    const xa = Math.max(0, Math.floor(r.l * p.k)), xb = Math.min(p.W, Math.ceil(r.r * p.k));
    const ya = Math.max(0, Math.floor((r.t - 2) * p.k)), yb = Math.min(p.H, Math.ceil((r.b + 2) * p.k));
    let top = -1, bottom = -1;
    for (let y = ya; y < yb; y++) for (let x = xa; x < xb; x++) if (differs(rgb(p, x, y), bg, th)) { if (top < 0) top = y; bottom = y; break; }
    return { top, bottom };
  };
  const crop = (p, r, name, scale = 3) => {
    const clip = { x: Math.max(0, Math.floor(r.l * p.k)), y: Math.max(0, Math.floor(r.t * p.k)) };
    clip.width = Math.min(p.W - clip.x, Math.ceil((r.r - r.l) * p.k)); clip.height = Math.min(p.H - clip.y, Math.ceil((r.b - r.t) * p.k));
    const part = p.img.crop(clip), { width: W, height: H } = part.getSize(), src = part.toBitmap(), out = Buffer.alloc(W * scale * H * scale * 4);
    for (let y = 0; y < H * scale; y++) for (let x = 0; x < W * scale; x++) { const from = (Math.floor(y / scale) * W + Math.floor(x / scale)) * 4; src.copy(out, (y * W * scale + x) * 4, from, from + 4); }
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${name}.png`), nativeImage.createFromBitmap(out, { width: W * scale, height: H * scale }).toPNG());
  };
  return { capture, rgb, gap, differs, ink, crop };
}

// The chosen list's row as drawn where the sidebar stands now (its fade's 0.2 s settled by the caller): the fill between the circle and
// the name, from 3px under the row's top to 3px over its foot, against the fill at its middle (the fade lightens the foot toward --side);
// the circle 9.5px over and under its centre (clear of its 14px icon and of its edge); the foot fade's opacity; and how far is left to
// scroll (scrollTop set to scrollHeight and back, after the picture).
async function chosenAtFoot({ mainWindow, run }, dir, name) {
  const px = pixels(mainWindow, dir);
  const R = `const R = n => { const r = n.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom }; };`;
  const dom = await run(mainWindow, `${R}
    const side = document.querySelector('#app .sidebar-scroll'), row = side?.querySelector('.list-nav.selected');
    if (!row) return null;
    const dot = row.querySelector('.list-dot'), words = document.createRange(); words.selectNodeContents(row.querySelector('.list-name'));
    return { view: innerWidth, side: R(side), row: R(row), dot: R(dot), name: R(words), id: row.dataset.nav,
      fade: getComputedStyle(side, '::after').opacity, top: side.scrollTop, scrolls: side.scrollHeight - side.clientHeight > 1 };`);
  if (!dom) return { name, chosen: false };
  const p = await px.capture(dom.view), k = p.k;
  const x = Math.round((dom.dot.r + dom.name.l) / 2 * k), mid = px.rgb(p, x, Math.round((dom.row.t + dom.row.b) / 2 * k));
  let fill = 0, fillAt = -1;
  for (let y = Math.round((dom.row.t + 3) * k); y <= Math.round((dom.row.b - 3) * k); y++) { const d = px.gap(px.rgb(p, x, y), mid); if (d > fill) { fill = d; fillAt = y; } }
  const cx = Math.round((dom.dot.l + dom.dot.r) / 2 * k), cy = (dom.dot.t + dom.dot.b) / 2;
  const up = px.rgb(p, cx, Math.round((cy - 9.5) * k)), down = px.rgb(p, cx, Math.round((cy + 9.5) * k));
  px.crop(p, { l: dom.side.l, t: Math.max(dom.side.t, dom.row.t - 40), r: dom.side.r, b: dom.side.b }, `sidebar-foot-${name}-x3`);
  const left = await run(mainWindow, `const side = document.querySelector('#app .sidebar-scroll'), now = side.scrollTop; side.scrollTop = side.scrollHeight;
    const end = side.scrollTop; side.scrollTop = now; return Math.round((end - now) * 1000) / 1000;`);
  const hex = c => '#' + c.map(v => v.toString(16).padStart(2, '0')).join('');
  return { name, chosen: true, id: dom.id, k: Math.round(k * 1000) / 1000, scrolls: dom.scrolls, top: dom.top, left, fade: dom.fade, footRoom: Math.round((dom.side.b - dom.row.b) * 100) / 100,
    fill, fillAt, fillMid: hex(mid), dot: [hex(up), hex(down)], dotGap: px.gap(up, down) };
}
// At the end nothing is left to scroll and the fade is off; anywhere the row's fill and circle are even (2 levels: the fade lightened them 6–8).
const footOk = f => Boolean(f && f.chosen && f.fill <= 2 && f.dotGap <= 2 && (f.left > 0.01 || f.fade === '0'));

module.exports = async function headKeys({ mainWindow, invoke, output, run, settle, expect, calm }) {
  const checks = [];
  const dir = path.join(output, 'head-keys-1112');
  fs.mkdirSync(dir, { recursive: true });
  const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
  const bounds = mainWindow.getBounds();
  const away = () => mainWindow.webContents.sendInputEvent({ type: 'mouseMove', x: 760, y: 420 });
  const still = async () => { await settle(mainWindow); await calm(mainWindow); await pause(120); await settle(mainWindow); };
  const { capture, rgb, differs, ink, crop } = pixels(mainWindow, dir);

  // ======== 1. 「나의 목록」 on the rows' rhythm ========
  const headDom = () => run(mainWindow, `
    const R = n => { const r = n.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom }; };
    const words = n => { const g = document.createRange(); g.selectNodeContents(n); return R(g); };
    const head = document.querySelector('.sidebar-section-head'), nav = document.querySelector('.sidebar-scroll > nav');
    const icons = [...head.querySelectorAll('.inline-actions svg')].map(R);
    const rows = [...nav.querySelectorAll('.section-head, .list-nav-wrap > .group-row, .list-nav-wrap > .list-nav')].filter(n => n.getClientRects().length).slice(0, 2).map(n => {
      const name = n.querySelector('.list-name, .group-name'), count = n.querySelector('.list-count'), dot = n.querySelector('.list-dot');
      return { kind: n.className.split(' ')[0], id: n.dataset.nav || '', row: R(n), dot: dot ? R(dot) : null, emoji: Boolean(dot && dot.classList.contains('emoji')), name: name ? words(name) : null, count: count && count.textContent ? words(count) : null,
        more: n.parentElement.querySelector(':scope > .list-more') ? R(n.parentElement.querySelector(':scope > .list-more')) : null };
    });
    const buttons = [...head.querySelectorAll('.icon-button')], plus = buttons.at(-1).getBoundingClientRect(), scroller = document.querySelector('.sidebar-scroll');
    return { view: innerWidth, side: R(document.querySelector('.sidebar')), tiles: Math.max(...[...document.querySelectorAll('.smart-tile')].map(t => t.getBoundingClientRect().bottom)),
      word: words(head.querySelector(':scope > span')), head: R(head), button: Math.round(plus.width * 100) / 100 + 'x' + Math.round(plus.height * 100) / 100,
      svg: [...head.querySelectorAll('.inline-actions svg')].map(s => getComputedStyle(s).width).join(),
      icons: icons.length ? { l: Math.min(...icons.map(r => r.l)), t: Math.min(...icons.map(r => r.t)), r: Math.max(...icons.map(r => r.r)), b: Math.max(...icons.map(r => r.b)) } : null,
      plusMid: plus.left + plus.width / 2, rows, scrolls: scroller.scrollHeight - scroller.clientHeight > 1, scrollbar: scroller.offsetWidth - scroller.clientWidth };`);
  // White rows (device px) between two inks. A circle by its drawn pixels too (th 40 finds the blue and the purple, light and dark: a box
  // rounded at 크게 put the second a device px off its drawing — 2026-11-12 check); an emoji's pale circle by its box.
  const rhythm = async (name, { light = true } = {}) => {
    away(); await still();
    const dom = await headDom(); const p = await capture(dom.view), k = p.k;
    const bg = rgb(p, Math.round(8 * k), Math.round((dom.head.t + dom.head.b) / 2 * k));
    const word = ink(p, bg, dom.word), icons = ink(p, bg, dom.icons);
    const [a, b] = dom.rows;
    expect(dom.rows.length === 2, `「나의 목록」 아래 두 줄 (${name}) ${JSON.stringify(dom.rows)} ${await run(mainWindow, `return document.querySelector('.sidebar-scroll > nav')?.innerText.slice(0, 300) || '';`)}`);
    const out = { name, k: Math.round(k * 1000) / 1000, bg: bg.join(), kinds: dom.rows.map(r => r.kind).join(), button: dom.button, svg: dom.svg, word, icons, scrolls: dom.scrolls, scrollbar: dom.scrollbar };
    out.above = word.top - Math.round(dom.tiles * k);
    if (a.name && b.name) { const n1 = ink(p, bg, a.name), n2 = ink(p, bg, b.name); out.names = [n1, n2]; out.wordToName = n1.top - word.bottom - 1; out.nameToName = n2.top - n1.bottom - 1; }
    if (a.dot && b.dot) {
      const drawn = r => (r.emoji ? { top: Math.round(r.dot.t * k), bottom: Math.round(r.dot.b * k) - 1 } : ink(p, bg, r.dot)), d1 = drawn(a), d2 = drawn(b);
      out.dotsBy = a.emoji || b.emoji ? 'box' : 'ink'; out.dots = [d1.top, d1.bottom, d2.top, d2.bottom]; out.wordToDot = out.dots[0] - word.bottom - 1; out.dotToDot = out.dots[2] - out.dots[1] - 1; }
    if (a.count && b.count) { const c1 = ink(p, bg, a.count), c2 = ink(p, bg, b.count); out.counts = [c1, c2]; out.iconsToCount = c1.top - icons.bottom - 1; out.countToCount = c2.top - c1.bottom - 1; }
    out.axis = a.more ? Math.round((dom.plusMid - (a.more.l + a.more.r) / 2) * 100) / 100 : null;
    out.headBottom = Math.round(dom.head.b * k); out.firstRowTop = Math.round(a.row.t * k);
    crop(p, { l: dom.side.l, t: dom.tiles - 8, r: dom.side.r, b: b.row.b + 6 }, `sidebar-head-${name}-x3`);
    // The first row's fill (selected, then under the pointer) and the heading's ink: white rows between them, at the circle's column
    // (inside the row's round corners), from just under the heading's lowest ink down to the fill's first row.
    const fill = async how => {
      if (how === 'selected') { await run(mainWindow, `goto(${JSON.stringify(a.id)}); return true;`); away(); }
      else mainWindow.webContents.sendInputEvent({ type: 'mouseMove', x: Math.round((a.row.l + a.row.r) / 2 * k), y: Math.round((a.row.t + a.row.b) / 2 * k) }); // window px = CSS px × zoom
      await still();
      const q = await capture(dom.view), ground = rgb(q, Math.round(8 * k), Math.round((dom.head.t + dom.head.b) / 2 * k));
      const x = Math.round(((a.dot ? (a.dot.l + a.dot.r) / 2 : a.row.l + 12)) * k), from = Math.max(word.bottom, icons.bottom) + 1;
      let top = -1; for (let y = from; y < Math.round(a.row.b * k); y++) if (differs(rgb(q, x, y), ground, 2)) { top = y; break; }
      crop(q, { l: dom.side.l, t: dom.tiles - 8, r: dom.side.r, b: b.row.b + 6 }, `sidebar-head-${name}-${how}-x3`);
      if (how === 'selected') await run(mainWindow, `goto('today'); return true;`);
      away(); await still();
      return { top, underWord: top - word.bottom - 1, underIcons: top - icons.bottom - 1 };
    };
    if (a.kind === 'list-nav' || a.kind === 'group-row') {
      if (a.kind === 'list-nav') out.selected = await fill('selected');
      out.hover = await fill('hover');
    }
    return out;
  };
  // the sidebar's first two rows directly under the heading: loose lists with counts (the owner's crop)
  await invoke('settings:update', { language: 'ko', theme: 'light', textSize: 'default' });
  mainWindow.setSize(1180, 780);
  await run(mainWindow, `closeModal?.(true); goto('today'); return true;`).catch(() => {});
  await still();
  const looseIds = () => run(mainWindow, `return [...document.querySelectorAll('.sidebar nav .lists-nav > .list-nav-wrap > .list-nav')].map(n => n.dataset.nav);`);
  const added = [];
  for (const [name, color] of [['업무', '#ff9500'], ['학업', '#5ac8fa']]) if ((await looseIds()).length < 2) { added.push(await invoke('list:add', { name, color })); await still(); }
  const firstTwo = (await looseIds()).slice(0, 2);
  const seeded = [];
  for (const listId of firstTwo) seeded.push(await invoke('task:add', { listId, title: '머리글 간격 확인' }));
  const rhythms = [];
  rhythms.push(await rhythm('light'));
  await invoke('settings:update', { theme: 'dark' });
  rhythms.push(await rhythm('dark'));
  await invoke('settings:update', { theme: 'light', textSize: 'large' });
  rhythms.push(await rhythm('large'));
  await invoke('settings:update', { textSize: 'larger' });
  rhythms.push(await rhythm('larger'));
  await invoke('settings:update', { textSize: 'default' });
  // a group first (its row is 34px and its name 13px: the name column only)
  const group = await invoke('group:add', { name: '생활' });
  const inGroup = await invoke('list:add', { name: '장보기', color: '#34c759', groupId: group.id });
  rhythms.push(await rhythm('group'));
  await invoke('list:delete', { id: inGroup.id });
  await invoke('group:delete', { id: group.id });
  // a sidebar that scrolls: its scrollbar takes width from the heading and the rows alike
  const many = [];
  for (let i = 1; i <= 14; i++) many.push(await invoke('list:add', { name: `목록 ${i}`, color: '#8e8e93' }));
  rhythms.push(await rhythm('scrolls'));
  await run(mainWindow, `document.querySelector('.sidebar-scroll').scrollTop = 40; return true;`); away(); await still();
  { const dom = await headDom(), p = await capture(dom.view); crop(p, { l: dom.side.l, t: Math.max(dom.side.t, dom.tiles - 8), r: dom.side.r, b: Math.min(dom.side.b, dom.word.b + 120) }, 'sidebar-head-scrolled-x3'); }
  await run(mainWindow, `document.querySelector('.sidebar-scroll').scrollTop = 0; return true;`);
  for (const l of many) await invoke('list:delete', { id: l.id });
  for (const t of seeded) await invoke('task:delete', { id: t.id }).catch(() => {});
  for (const l of added) await invoke('list:delete', { id: l.id });
  fs.writeFileSync(path.join(dir, 'sidebar-head-on-rhythm.json'), JSON.stringify(rhythms, null, 1));
  // Exact at 100%. Zoomed (크게 ×1.125, 더 크게 ×1.25) each white gap is rounded on its own — at 더 크게 the rows' pitch is 46 or 47 device px
  // (37 × 1.25 = 46.25) and the 15px word's ink ends a row lower than 1.25 × its 12px ink — so two gaps of 16.25 can be drawn 15 and 17:
  // one device px of rounding at each of the two gaps (the drawn circles, 2026-11-12: 100% 13 and 13, 크게 14 and 15, 더 크게 15 and 17 — the
  // first report's 「크게 14 = 14」 measured the circles' rounded boxes).
  const tol = r => (r.k === 1 ? 0 : 2);
  const loose = r => r.kinds === 'list-nav,list-nav' && r.dotsBy === 'ink' && r.button === '24x24' && r.svg === '16px,16px' && r.word.top > 0 && r.icons.top > 0
    && Math.abs(r.wordToDot - r.dotToDot) <= tol(r) && r.wordToName <= r.nameToName && r.iconsToCount <= r.countToCount
    && r.above >= 2 * r.wordToDot && Math.abs(r.axis) <= 0.5 && r.selected.underWord >= 1 && r.selected.underIcons >= 1 && r.hover.underWord >= 1 && r.hover.underIcons >= 1;
  const byName = n => rhythms.find(r => r.name === n);
  const g = byName('group');
  expect(['light', 'dark', 'large', 'larger', 'scrolls'].every(n => loose(byName(n))) && byName('scrolls').scrolls && byName('scrolls').scrollbar > 0
    && byName('light').wordToDot === 13 && byName('dark').wordToDot === 13
    && g.kinds === 'group-row,list-nav' && g.wordToName <= g.nameToName && g.hover.underWord >= 1 && g.hover.underIcons >= 1,
  `「나의 목록」 머리글 간격 ${JSON.stringify(rhythms.map(({ names, counts, dots, ...r }) => r))}`);
  checks.push('sidebar-head-on-rhythm');

  // ======== 1b. the list chosen last stops clear of the foot's fade ========
  // As ui-smoke's subtasks-narrow got there: chosen at 1180×780 and 기본, then the text size, then 900 wide (each a resize, each
  // sidebarKeepChosen); one to four lists more, so the end falls on other fractions at ×1.125 and ×1.25.
  const feet = [], more = [];
  await invoke('settings:update', { language: 'ko', theme: 'light', textSize: 'default' });
  for (let i = 1; i <= 4; i++) {
    more.push(await invoke('list:add', { name: `끝 목록 ${i}`, color: '#3478f6' }));
    for (const textSize of ['default', 'large', 'larger']) {
      await invoke('settings:update', { textSize: 'default' });
      mainWindow.setSize(1180, 780); away(); await still();
      await run(mainWindow, `goto(${JSON.stringify(more.at(-1).id)}); return true;`); await still();
      await invoke('settings:update', { textSize }); await still();
      mainWindow.setSize(900, 780); await still(); await pause(350); await still();
      feet.push({ more: i, textSize, ...await chosenAtFoot({ mainWindow, run }, dir, `${textSize}-${i}`) });
    }
  }
  await run(mainWindow, `goto('today'); return true;`);
  await invoke('settings:update', { textSize: 'default' });
  mainWindow.setSize(1180, 780);
  for (const l of more) await invoke('list:delete', { id: l.id });
  await still();
  fs.writeFileSync(path.join(dir, 'sidebar-chosen-at-foot.json'), JSON.stringify(feet, null, 1));
  // the last list: the very end, nothing left to scroll; at 더 크게 the sidebar scrolls in every case (else nothing was tried)
  expect(feet.every(f => footOk(f) && f.left <= 0.01) && feet.filter(f => f.textSize === 'larger').every(f => f.scrolls && f.top > 0),
    `고른 마지막 목록이 사이드바 아래 흐림 밑에 깔림 ${JSON.stringify(feet)}`);
  checks.push('sidebar-chosen-at-foot');

  // ======== 2. the mouse action's key cap ========
  const PROPS = ['display', 'box-sizing', 'height', 'min-width', 'padding-top', 'padding-right', 'padding-bottom', 'padding-left', 'border-top-left-radius', 'border-bottom-right-radius',
    'border-top-width', 'background-color', 'color', 'box-shadow', 'font-family', 'font-size', 'font-weight', 'line-height', 'letter-spacing', 'vertical-align', 'white-space'];
  const caps = [];
  for (const language of ['ko', 'en']) for (const theme of ['light', 'dark']) for (const [w, hgt] of [[1180, 780], [900, 650]]) {
    await invoke('settings:update', { language, theme });
    mainWindow.setSize(w, hgt); away();
    await run(mainWindow, `closeModal?.(true); goto('today'); openShortcuts(); return true;`);
    await still();
    const m = await run(mainWindow, `
      const PROPS = ${JSON.stringify(PROPS)};
      const look = n => { const s = getComputedStyle(n); return PROPS.map(p => s.getPropertyValue(p)).join('|'); };
      const lines = n => { const g = document.createRange(); g.selectNodeContents(n); return new Set([...g.getClientRects()].filter(x => x.width > 1).map(x => Math.round(x.top))).size; };
      const R = n => { const r = n.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom }; };
      const body = document.querySelector('#modal-root .shortcuts-body'), mouse = body.querySelector('kbd.keys-mouse');
      const keys = [...body.querySelectorAll('.keys kbd:not(.keys-mouse)')], ref = look(keys[0]);
      const row = mouse.closest('.shortcut-row'), above = row.previousElementSibling, dt = row.querySelector('dt');
      const c = mouse.getBoundingClientRect(), r = row.getBoundingClientRect(), d = dt.getBoundingClientRect(), k = above.querySelector('kbd').getBoundingClientRect();
      const sheet = body.closest('.dialog').getBoundingClientRect();
      return { view: innerWidth, text: mouse.textContent, el: mouse.tagName, kids: mouse.children.length, same: look(mouse) === ref, keysSame: keys.every(n => look(n) === ref),
        differ: PROPS.filter((p, i) => look(mouse).split('|')[i] !== ref.split('|')[i]).join(), look: ref,
        cap: Math.round(c.width * 100) / 100 + 'x' + Math.round(c.height * 100) / 100, capLines: lines(mouse), labelLines: lines(dt), label: dt.textContent,
        wrapped: [...body.querySelectorAll('.shortcut-row dt')].filter(n => lines(n) > 1).map(n => n.textContent),
        rowH: Math.round(r.height * 100) / 100, aboveH: Math.round(above.getBoundingClientRect().height * 100) / 100, belowH: Math.round(row.nextElementSibling.getBoundingClientRect().height * 100) / 100,
        inside: c.right <= r.right + 0.5 && c.left >= d.right + 0.5 && c.right <= sheet.right, mid: Math.round(((c.top + c.bottom) / 2 - (r.top + r.bottom) / 2) * 100) / 100,
        rightEdge: Math.round((r.right - c.right) * 100) / 100, aboveRightEdge: Math.round((r.right - [...above.querySelectorAll('kbd')].at(-1).getBoundingClientRect().right) * 100) / 100,
        capH: Math.round(k.height * 100) / 100, crop: { l: d.left - 8, t: above.getBoundingClientRect().top - 4, r: r.right + 8, b: r.bottom + 4 } };`);
    const tag = `${language}-${theme}-${w}`;
    const p = await capture(m.view);
    crop(p, m.crop, `keys-row-${tag}-x3`);
    fs.writeFileSync(path.join(dir, `keys-sheet-${tag}.png`), p.img.toPNG());
    await run(mainWindow, `closeModal(true); return true;`); await still();
    const card = await run(mainWindow, `helpOpen(true); await new Promise(resolve => setTimeout(resolve, 250));
      const PROPS = ${JSON.stringify(PROPS)};
      const look = n => { const s = getComputedStyle(n); return PROPS.map(p => s.getPropertyValue(p)).join('|'); };
      const pop = document.querySelector('.help-pop'); const kbds = pop ? [...pop.querySelectorAll('kbd')] : [];
      return { open: Boolean(pop), caps: kbds.length, looks: [...new Set(kbds.map(look))] };`);
    await still();
    fs.writeFileSync(path.join(dir, `keys-card-${tag}.png`), (await mainWindow.webContents.capturePage()).toPNG());
    await run(mainWindow, `helpClose(); return true;`);
    caps.push({ tag, ...m, card: { open: card.open, caps: card.caps, same: card.looks.length === 1 && card.looks[0] === m.look } });
  }
  await invoke('settings:update', { language: 'ko', theme: 'light' });
  mainWindow.setBounds(bounds);
  await run(mainWindow, `goto('today'); return true;`); await still();
  fs.writeFileSync(path.join(dir, 'shortcuts-mouse-cap.json'), JSON.stringify(caps, null, 1));
  // The row keeps one line (its label too, 「Expand or collapse subtasks」 beside the 82px cap) and the height of the one-line row under it
  // (오른쪽 패널 /); the row above (「Expand or collapse all」 and its four caps) is on one line too since its English was shortened (2026-11-12,
  // ui-smoke-sheet-lines-1112.cjs shortcut-sheet-one-line).
  const capOk = c => c.text === (c.tag.startsWith('ko') ? '더블클릭' : 'Double-click') && c.el === 'KBD' && c.kids === 0
    && c.same && c.keysSame && c.capLines === 1 && c.cap.endsWith('x22') && c.capH === 22 && c.labelLines === 1 && c.inside && Math.abs(c.mid) <= 0.5
    && c.rowH === c.belowH && c.rightEdge === c.aboveRightEdge && c.card.open && c.card.caps > 0 && c.card.same;
  expect(caps.length === 8 && caps.every(capOk), `더블클릭 키캡 ${JSON.stringify(caps.map(({ look, crop, ...c }) => c))}`);
  checks.push('shortcuts-mouse-cap');
  return checks;
};
module.exports.chosenAtFoot = chosenAtFoot;
module.exports.footOk = footOk;
module.exports.pixels = pixels; // also tests/ui-smoke-sheet-lines-1112.cjs
