'use strict';
// r50 area K, round 3 (2026-10-28 owner 「작은 로고로」): the day panel's calendar rows end in the service's small mark instead of
// the word 「Google / Microsoft / 이 PC」 (round 2 hid that word below 1600px, so calendars with the same name from two accounts
// looked alike, Codex re-review). The mark is the account screens' shape in the muted text colour, and an image named after the
// service, so the row still says which account it is when the mark steps aside for a long name (styles.css; measured in the
// smoke check calendar-panel-fluid). The real calendarList and calendarMark from renderer/app.js run in a VM with a small
// element stand-in.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const D = require('../renderer/domain.js');

const project = path.resolve(__dirname, '..');
const appLines = fs.readFileSync(path.join(project, 'renderer/app.js'), 'utf8').split(/\r?\n/);
const appLine = prefix => { const line = appLines.find(l => l.startsWith(prefix)); assert.ok(line, prefix + ' is still in app.js'); return line; };

class El {
  constructor(tag, attrs = {}) { this.tag = tag; this.attrs = { ...attrs }; this.children = []; this.namespaceURI = 'http://www.w3.org/2000/svg'; }
  get textContent() { return this.children.map(c => typeof c === 'string' ? c : c.textContent).join(''); }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  getAttribute(k) { return this.attrs[k] == null ? null : String(this.attrs[k]); }
  append(...nodes) { this.children.push(...nodes); }
  get className() { return this.attrs.class || ''; }
  find(test) { for (const c of this.children) { if (typeof c === 'string') continue; if (test(c)) return c; const deep = c.find(test); if (deep) return deep; } return null; }
  all(test, out = []) { for (const c of this.children) { if (typeof c === 'string') continue; if (test(c)) out.push(c); c.all(test, out); } return out; }
}
const flat = list => list.flat(Infinity).filter(c => c != null && c !== false).map(c => typeof c === 'number' ? String(c) : c);
const h = (tag, attrs, ...children) => { const el = new El(tag, attrs || {}); el.children = flat(children); return el; };
const byClass = name => node => node.className.split(/\s+/).includes(name);

function render(calendars, settings = {}) {
  const context = {
    D, h, console, state: { calendars, settings: { hiddenCalendars: [], ...settings }, events: [{ id: 'e1', calendarId: 'local-calendar' }], accounts: [] }, // one local event keeps 이 PC listed
    tr: (text, params) => params ? text.replace(/\{(\d+)\}/g, (m, i) => String(params[i])) : text,
    document: { createElementNS: (ns, tag) => new El(tag) },
    calendarColor: c => c.color, calendarMenu() {}, toggleCalendar() {},
  };
  vm.createContext(context);
  for (const prefix of ['const paths=', 'Object.assign(paths,', 'const fills=', 'function icon(', 'const providerName=', 'const svgNS=', 'function brandSvg(', 'const googleParts=', 'const cloudPath=', 'function calendarMark(', 'function calendarList(']) {
    vm.runInContext(appLine(prefix), context, { filename: 'renderer/app.js' });
  }
  const get = name => vm.runInContext(name, context);
  return { list: context.calendarList(), context, googleParts: get('googleParts'), cloudPath: get('cloudPath') };
}

const CALENDARS = [
  { id: 'g1', provider: 'google', accountId: 'g', name: 'haeun12@example.com', color: '#f0a13a', readOnly: false, primary: true },
  { id: 'g2', provider: 'google', accountId: 'g', name: '생일', color: '#e5484d', readOnly: true },
  { id: 'm1', provider: 'microsoft', accountId: 'm', name: '생일', color: '#3a86ff', readOnly: true },
  { id: 'i1', provider: 'icloud', accountId: 'i', name: '가족', color: '#34c759', readOnly: false },
  { id: 'local-calendar', provider: 'local', name: '개인 일정', color: '#ff6b5b', readOnly: false },
];
const rowsOf = list => list.all(byClass('calendar-row')).map(row => {
  const button = row.find(byClass('cal-name-button')), label = button.children[0], mark = button.children[1];
  return { row, button, label, mark, name: row.find(byClass('cal-name')).textContent, badges: row.all(byClass('cal-badge')).map(b => b.textContent) };
});

test('every calendar row ends in a mark named after its service, never the word, with name and badges in one box', () => {
  const { list } = render(CALENDARS, { defaultCalendarId: 'g1' });
  const rows = rowsOf(list);
  assert.deepEqual(rows.map(r => r.name), ['haeun12@example.com', '생일', '생일', '가족', '개인 일정']);
  for (const r of rows) {
    assert.equal(r.button.children.length, 2, `${r.name}: the button holds the label box and the mark`);
    assert.ok(byClass('cal-label')(r.label), `${r.name}: name and badges share .cal-label`);
    assert.equal(r.label.children[0].className, 'cal-name');
    assert.ok(byClass('cal-provider')(r.mark), `${r.name}: the mark closes the row`);
    assert.equal(r.row.all(node => node.tag === 'small').length, 0, `${r.name}: no provider word`);
  }
  assert.deepEqual(rows.map(r => r.badges.join()), ['기본', '읽기 전용', '읽기 전용', '', '']);
  // An image named after the service, also first in the tooltip; the two 「생일」 rows differ by their marks.
  assert.deepEqual(rows.map(r => [r.mark.getAttribute('role'), r.mark.getAttribute('aria-label')]), [['img', 'Google'], ['img', 'Google'], ['img', 'Microsoft'], ['img', 'iCloud'], ['img', '이 PC']]);
  for (const r of rows) assert.ok(r.button.attrs.title.startsWith(r.mark.getAttribute('aria-label') + ' · '), `${r.name}: tooltip ${r.button.attrs.title}`);
});

test('the marks are the account screens\' shapes in the muted text colour, within 14px', () => {
  const { list, googleParts, cloudPath } = render(CALENDARS);
  const marks = Object.fromEntries(rowsOf(list).map(r => [r.mark.getAttribute('aria-label'), r.mark.children[0]]));
  const fills = svg => svg.all(node => node.tag === 'path').map(p => p.getAttribute('fill'));
  // Google: the four parts of the G as one path (no seams between them), not its four brand colours.
  const g = marks.Google;
  assert.deepEqual(fills(g), ['currentColor']);
  assert.equal(g.children[0].getAttribute('d'), googleParts.map(p => p[1]).join(''));
  assert.equal(marks.iCloud.children[0].getAttribute('d'), cloudPath);
  assert.deepEqual(fills(marks.Microsoft), ['currentColor']);
  assert.equal(marks.Microsoft.children[0].getAttribute('d').match(/M/g).length, 4, 'four squares');
  // 이 PC: the app's monitor glyph, its outline a little heavier at this size.
  assert.equal(marks['이 PC'].getAttribute('data-icon'), 'monitor');
  assert.equal(marks['이 PC'].getAttribute('stroke-width'), '2');
  for (const [name, svg] of Object.entries(marks)) {
    assert.ok(Number(svg.getAttribute('width')) <= 14 && Number(svg.getAttribute('height')) <= 14, `${name} within 14px`);
    assert.equal(svg.getAttribute('aria-hidden'), 'true', `${name}: the span carries the name, not the drawing`);
  }
  for (const [name] of googleParts) assert.ok(!JSON.stringify(marks).includes(name), `no brand colour ${name}`);
});

test('a hidden calendar keeps its mark, dimmed like the badges', () => {
  const { list } = render(CALENDARS, { hiddenCalendars: ['m1'] });
  const row = rowsOf(list).find(r => r.mark.getAttribute('aria-label') === 'Microsoft');
  assert.ok(byClass('hidden')(row.row));
  const css = fs.readFileSync(path.join(project, 'renderer', 'styles.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  assert.match(css, /\.calendar-row\.hidden \.cal-badge,\.calendar-row\.hidden \.cal-provider\{opacity:\.6\}/);
  assert.match(css, /\.cal-provider\{[^}]*color:var\(--muted\)/);
});
