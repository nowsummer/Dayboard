'use strict';
// event-shortcuts, the editor's look (2026-11-13; the rules and the DOM: tests/event-word-sheet-1113.test.cjs). In the running app, with a
// second writable calendar so the 달력 row shows: 색 is the first group's row right after the emoji grid and 더 보기 holds none; its 13 dots
// show while 더 보기 is shut, 7 on one line and the 8th 30px lower, the first on the 적을 낱말 field's left edge; the row is 72px; a chosen
// ring keeps 5px off the row's top and 6px off its bottom (달력 색 and 회색 chosen); 「색」 is centred on the first line of dots; the ring's
// gap is the group's colour. 더 보기 by .click() (the keyboard's detail 0) goes away and leaves the keyboard on 뒤에 붙일 말, the preview 12px
// over the group; 달력 and 알림 end 6px past the fields' edge (S1's −6px margin, the chevron on the fields' line), 28px tall, no fill; a new
// 달력 redraws 달력 색 in its colour; a colour-only item opens with 더 보기 shut and its dot chosen above. Light and dark, ko and en, and
// 1180×780 at 더 크게 (×1.25). Pictures event-word-form(-more, -more-dark, -more-en, -more-larger).png, numbers event-word-sheet.json.
// Called by tests/ui-smoke.cjs at the end of event-shortcuts (DAYBOARD_SMOKE_ONLY=event-word runs it alone); returns the passed check
// names, throws on the first failure with every failed judgement.
const fs = require('node:fs');
const path = require('node:path');

const SECOND = { id: 'smoke-word-cal', provider: 'google', accountId: 'smoke-word', name: '스모크 회사 달력', color: '#30b0c7', readOnly: false };
const GREY = 11; // the dot of #8e8e93: 달력 색, then the palette's 11 colours (grey last), then 다른 색
const COLOUR_ONLY = { id: 'smoke-colour-only', word: '운동', before: '', after: '', start: '07:00', end: '08:00', allDay: false, calendarId: '', color: '#34c759', created: 1 };

module.exports = async function eventWord({ mainWindow, invoke, output, run, settle, calm }) {
  const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
  const shot = async name => { await settle(mainWindow); await calm(mainWindow); fs.writeFileSync(path.join(output, `${name}.png`), (await mainWindow.webContents.capturePage()).toPNG()); };
  const fails = [];
  const judge = (ok, what, value) => { if (!ok) fails.push({ what, value }); return ok; };
  const near = (a, b, tol = 0.01) => typeof a === 'number' && typeof b === 'number' && Math.abs(a - b) <= tol;

  // the sheet from 설정, the item named `word` (an example when the list is empty; the first row when word is null); the second calendar
  // goes into the page's state in the same step as the row's click (a state from main in between would drop it)
  // …and measured once the sheet's entrance is over (a sheet still scaling in measured its 72px row as 69.5 on 2026-11-14)
  const open = async word => { const said = await openSheet(word); await settle(mainWindow); await calm(mainWindow); await settle(mainWindow); return said; };
  const openSheet = word => run(mainWindow, `
    const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
    tipHide?.(); closeModal(true); await wait(80);
    openSettings(); await wait(160); document.querySelector('#modal-root .event-word-entry .text-button').click(); await wait(200);
    const rows = [...document.querySelectorAll('#modal-root .event-word-row')];
    const row = ${JSON.stringify(word)} === null ? rows[0] : rows.find(r => r.querySelector('strong').textContent === ${JSON.stringify(word)});
    if (!row) return 'no row: ' + rows.map(r => r.querySelector('strong').textContent).join();
    const cal = ${JSON.stringify(SECOND)}; if (!state.calendars.some(c => c.id === cal.id)) state.calendars.push(cal);
    row.click(); await wait(220);
    return document.querySelector('#modal-root .event-word-form') ? 'ok' : 'no form';`);
  // the colour row and the groups as laid out (CSS px)
  const MEASURE = `
    const R = n => { if (!n || !n.getClientRects().length) return null; const r = n.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height }; };
    const form = document.querySelector('#modal-root .event-word-form');
    const groups = [...form.children].filter(n => n.classList.contains('settings-group')), first = groups[0], more = groups[1];
    const row = form.querySelector('.event-word-colors'), dots = [...row.querySelectorAll('.swatch')], sel = row.querySelector('.swatch.selected');
    const label = row.querySelector(':scope>span'), word = form.querySelector('input[aria-label]'), rr = R(row), sr = R(sel);
    const out = {
      inFirst: row.parentElement === first, afterEmoji: Boolean(row.previousElementSibling && row.previousElementSibling.classList.contains('event-word-emoji')),
      moreColours: more.querySelectorAll('.event-word-colors').length, moreHidden: more.hidden, toggleShown: getComputedStyle(form.querySelector('.event-word-more')).display !== 'none',
      dots: dots.length, shown: dots.filter(d => d.getClientRects().length).length, tops: dots.map(d => R(d) && R(d).t), first: R(dots[0]), wordLeft: R(word).l,
      row: rr, labelMid: (R(label).t + R(label).b) / 2, chosen: sel ? sel.getAttribute('aria-label') : '', chosenIndex: dots.indexOf(sel),
      ringTop: sr ? (sr.t - 4) - rr.t : null, ringBottom: sr ? rr.b - (sr.b + 4) : null, shadow: sel ? getComputedStyle(sel).boxShadow : '',
      field: getComputedStyle(first).backgroundColor, label: label.textContent,
      small: [...form.querySelectorAll('*')].filter(n => n.children.length === 0 && n.textContent.trim() && n.getClientRects().length && parseFloat(getComputedStyle(n).fontSize) < 12).length };
    out.lastBottom = R(dots.at(-1)).b;`;
  const closed = () => run(mainWindow, `${MEASURE} return out;`);
  const judgeClosed = (m, tag, chosen) => {
    judge(m.inFirst && m.afterEmoji, `${tag}: 색 in the first group right after the emoji grid`, [m.inFirst, m.afterEmoji]);
    judge(m.moreColours === 0, `${tag}: 더 보기 holds no 색`, m.moreColours);
    judge(m.dots === 13 && m.shown === 13, `${tag}: 13 dots shown`, [m.dots, m.shown]);
    judge(m.tops.slice(0, 7).every(t => near(t, m.tops[0])) && m.tops.slice(7).every(t => near(t, m.tops[7])), `${tag}: 7 + 6`, m.tops);
    judge(near(m.tops[7] - m.tops[0], 30), `${tag}: the 8th 30px lower`, m.tops[7] - m.tops[0]);
    judge(near(m.first.l, m.wordLeft, 0.5), `${tag}: the first dot on 적을 낱말's left edge`, [m.first.l, m.wordLeft]);
    judge(near(m.row.h, 72), `${tag}: a 72px row`, m.row.h);
    judge(near(m.first.w, 22) && near(m.first.h, 22), `${tag}: 22px dots`, m.first);
    judge(Math.abs(m.labelMid - (m.first.t + m.first.b) / 2) <= 1, `${tag}: 「색」 on the first line`, [m.labelMid, m.first]);
    judge(m.ringTop >= 5 - 0.01 && m.ringBottom >= 6 - 0.01, `${tag}: the ring 5px off the top and 6px off the bottom (${m.chosen})`, [m.ringTop, m.ringBottom]);
    judge(m.row.b - (m.lastBottom + 4) >= 6 - 0.01 && (m.first.t - 4) - m.row.t >= 5 - 0.01, `${tag}: any ring clear of both dividers`, [m.first.t - m.row.t, m.row.b - m.lastBottom]);
    judge(m.chosenIndex === chosen, `${tag}: the chosen dot`, [m.chosenIndex, m.chosen]);
    judge(m.shadow.includes(m.field), `${tag}: the ring's gap is the group's colour`, [m.shadow, m.field]);
    judge(m.small === 0, `${tag}: nothing under 12px`, m.small);
  };
  // 더 보기 by .click() (detail 0, as Enter and Space), then the opened group
  const opened = () => run(mainWindow, `
    const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
    const R = n => { const r = n.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height }; };
    const form = document.querySelector('#modal-root .event-word-form'), toggle = form.querySelector('.event-word-more');
    toggle.click(); await wait(80);
    const more = toggle.nextElementSibling, after = more.querySelector('input'), preview = form.querySelector('.event-word-preview');
    const out = { toggle: getComputedStyle(toggle).display, open: !more.hidden, expanded: toggle.getAttribute('aria-expanded'), keyboard: document.activeElement === after,
      gap: R(more).t - R(preview).b, after: R(after),
      selects: [...more.querySelectorAll('select')].map(s => { const cs = getComputedStyle(s); return { r: R(s).r, h: R(s).h, bg: cs.backgroundColor, text: s.querySelector('selectedcontent')?.textContent || '' }; }),
      small: [...form.querySelectorAll('*')].filter(n => n.children.length === 0 && n.textContent.trim() && n.getClientRects().length && parseFloat(getComputedStyle(n).fontSize) < 12).length };
    after.blur(); return out;`);
  const judgeOpened = (o, tag) => {
    judge(o.toggle === 'none' && o.open && o.expanded === 'true', `${tag}: 더 보기 gone once opened`, [o.toggle, o.open, o.expanded]);
    judge(o.keyboard, `${tag}: the keyboard on 뒤에 붙일 말`, o.keyboard);
    judge(near(o.gap, 12), `${tag}: the preview 12px over the group`, o.gap);
    judge(o.selects.length === 2, `${tag}: 달력 and 알림`, o.selects.length);
    for (const [i, s] of o.selects.entries()) {
      judge(Math.abs((s.r - 6) - o.after.r) <= 1, `${tag}: select ${i} ends on the fields' line`, [s.r, o.after.r]);
      judge(near(s.h, 28), `${tag}: select ${i} 28px`, s.h);
      judge(s.bg === 'rgba(0, 0, 0, 0)', `${tag}: select ${i} unfilled`, s.bg);
    }
    judge(o.small === 0, `${tag}: nothing under 12px`, o.small);
  };
  const pickGrey = () => run(mainWindow, `const wait = ms => new Promise(resolve => setTimeout(resolve, ms)); document.querySelectorAll('#modal-root .event-word-colors .swatch')[${GREY}].click(); await wait(60); return true;`);

  const was = (await invoke('state:get')).settings;
  const bounds = mainWindow.getBounds();
  const out = {};
  try {
    await invoke('settings:update', { theme: 'light', language: 'ko', textSize: 'default', eventShortcuts: [] }); await pause(500);

    // 1. Korean, light: the closed sheet (달력 색 chosen, then 회색), opened, a new 달력
    judge(await open('점심') === 'ok', 'ko: the 점심 example opens', null);
    out.closed = await closed(); judgeClosed(out.closed, 'ko closed 달력 색', 0);
    await shot('event-word-form');
    await pickGrey(); out.closedGrey = await closed(); judgeClosed(out.closedGrey, 'ko closed 회색', GREY);
    judge(out.closedGrey.shadow.includes('rgb(242, 243, 247)'), 'ko light: the ring\'s gap #f2f3f7', out.closedGrey.shadow);
    out.opened = await opened(); judgeOpened(out.opened, 'ko');
    await shot('event-word-form-more');
    out.follow = await run(mainWindow, `
      const wait = ms => new Promise(resolve => setTimeout(resolve, ms)); const out = [];
      const sel = document.querySelector('#modal-root .event-word-form .event-word-more').nextElementSibling.querySelector('select');
      const cal = ${JSON.stringify(SECOND)};
      for (const id of [cal.id, 'local-calendar', '']) {
        if (!state.calendars.some(c => c.id === cal.id)) state.calendars.push(cal);
        sel.value = id; sel.dispatchEvent(new Event('change', { bubbles: true })); await wait(40);
        const reset = document.querySelector('#modal-root .event-word-colors .swatch.reset');
        const want = calendarColor(state.calendars.find(c => c.id === (id || D.defaultCalendarId(state))));
        out.push({ id, want, swatch: reset.style.getPropertyValue('--swatch'), chosen: document.querySelector('#modal-root .event-word-colors .swatch.selected')?.getAttribute('aria-label') || '' });
      }
      return out;`);
    for (const f of out.follow) judge(f.swatch === f.want && f.chosen === '회색', `달력 「${f.id || '자동'}」: 달력 색 follows, 회색 stays chosen`, f);
    judge(new Set(out.follow.map(f => f.want)).size >= 2, 'the calendars differ in colour (the check means something)', out.follow);

    // 2. dark
    await invoke('settings:update', { theme: 'dark' }); await pause(400);
    judge(await open('점심') === 'ok', 'dark: the 점심 example opens', null);
    await pickGrey(); out.darkClosed = await closed(); judgeClosed(out.darkClosed, 'dark closed 회색', GREY);
    judge(out.darkClosed.shadow.includes('rgb(48, 51, 59)'), 'dark: the ring\'s gap #30333b', out.darkClosed.shadow);
    out.darkOpened = await opened(); judgeOpened(out.darkOpened, 'dark');
    await shot('event-word-form-more-in-dark');
    await invoke('settings:update', { theme: 'light' }); await pause(400);

    // 3. English: Color, a long alert label
    await invoke('settings:update', { language: 'en' }); await pause(500);
    judge(await open(null) === 'ok', 'en: the first example opens', null);
    await pickGrey(); out.enClosed = await closed(); judgeClosed(out.enClosed, 'en closed grey', GREY);
    judge(out.enClosed.label === 'Color', 'en: the row reads Color', out.enClosed.label);
    out.enOpened = await opened(); judgeOpened(out.enOpened, 'en');
    await run(mainWindow, `const wait = ms => new Promise(resolve => setTimeout(resolve, ms)); const alert = [...document.querySelectorAll('#modal-root .event-word-form select')].at(-1);
      alert.value = [...alert.options].reduce((a, b) => b.textContent.length > a.textContent.length ? b : a).value; alert.dispatchEvent(new Event('change', { bubbles: true })); await wait(60); return true;`);
    out.enLong = await run(mainWindow, `const R = n => { const r = n.getBoundingClientRect(); return { l: r.left, r: r.right }; }; const form = document.querySelector('#modal-root .event-word-form'); const alert = [...form.querySelectorAll('select')].at(-1), after = form.querySelector('.event-word-more').nextElementSibling.querySelector('input'), label = alert.closest('.field').querySelector(':scope>span');
      return { text: alert.querySelector('selectedcontent')?.textContent || '', r: R(alert).r, after: R(after).r, labelRight: R(label).r, left: R(alert).l };`);
    judge(out.enLong.text.length >= 16, 'en: the longest alert label chosen', out.enLong.text);
    judge(Math.abs((out.enLong.r - 6) - out.enLong.after) <= 1 && out.enLong.left >= out.enLong.labelRight, 'en: a long alert still ends on the fields\' line, clear of its label', out.enLong);
    await shot('event-word-form-more-en');
    await invoke('settings:update', { language: 'ko' }); await pause(500);

    // 4. 1180×780 at 더 크게 (×1.25): a 624px page
    mainWindow.setBounds({ ...bounds, width: 1180, height: 780 }); await pause(300);
    await invoke('settings:update', { textSize: 'larger' }); await pause(600);
    judge(await open('점심') === 'ok', 'larger: the 점심 example opens', null);
    await pickGrey(); out.largerClosed = await closed(); judgeClosed(out.largerClosed, 'larger closed 회색', GREY);
    out.largerOpened = await opened(); judgeOpened(out.largerOpened, 'larger');
    out.larger = await run(mainWindow, `const d = document.querySelector('#modal-root .dialog'); return { view: innerHeight, dialog: d.getBoundingClientRect().height, scroll: d.scrollHeight - d.clientHeight };`);
    await shot('event-word-form-more-larger');
    await invoke('settings:update', { textSize: 'default' }); await pause(600);
    mainWindow.setBounds(bounds); await pause(300);

    // 5. a colour-only item: 더 보기 shut, its dot chosen in the first group
    await invoke('settings:update', { eventShortcuts: [COLOUR_ONLY] }); await pause(400);
    judge(await open(COLOUR_ONLY.word) === 'ok', 'the colour-only item opens', null);
    out.colourOnly = await closed();
    judge(out.colourOnly.moreHidden && out.colourOnly.toggleShown && out.colourOnly.inFirst && out.colourOnly.chosen === '초록', 'colour only: 더 보기 shut, 초록 chosen above', out.colourOnly);
  } finally {
    await run(mainWindow, `tipHide?.(); closeModal(true); return true;`).catch(() => {});
    await invoke('settings:update', { theme: was.theme, language: was.language, textSize: was.textSize, eventShortcuts: [] }); await pause(500);
    mainWindow.setBounds(bounds); await pause(200);
    fs.writeFileSync(path.join(output, 'event-word-sheet.json'), JSON.stringify({ out, fails }, null, 1));
  }
  if (fails.length) throw new Error(`UI 검증 실패: 자주 쓰는 일정 편집 모양 ${fails.length}건 ${JSON.stringify(fails).slice(0, 3000)}`);
  return ['event-word-sheet'];
};
