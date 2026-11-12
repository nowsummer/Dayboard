'use strict';
// r60 area T (2026-11-02 review usability-5 / usability-8). The real empty(), tasksView() and the empty-notes branch of
// notesView() from renderer/app.js run in a VM over a small element stand-in (as tests/r50-K-quick-hint.test.cjs does):
// - a search that only matches completed tasks shows the 「완료한 할 일」 section first, not 「검색 결과가 없어요」 above it;
// - a search with no match at all shows one title line naming the search term, without a description paragraph;
// - the task toolbar shows no standing caption (「오늘 할 일과 지나간 할 일」「모든 목록」「이 PC」); only the search count and an
//   account list's service stay;
// - the empty notes screen is a title and one short line (no Delete-key sentence, no button), the trash link kept.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const project = path.resolve(__dirname, '..');
const appLines = fs.readFileSync(path.join(project, 'renderer/app.js'), 'utf8').split(/\r?\n/);
const appLine = prefix => { const line = appLines.find(l => l.startsWith(prefix)); assert.ok(line, prefix + ' is still in app.js'); return line; };

class El {
  constructor(tag, attrs = {}) { this.tag = tag; this.attrs = attrs; this.children = []; }
  get className() { return String(this.attrs.class || ''); }
  get textContent() { return this.children.map(c => typeof c === 'string' ? c : c.textContent).join(''); }
}
const flat = list => list.flat(Infinity).filter(c => c != null && c !== false && c !== '').map(c => typeof c === 'number' ? String(c) : c);
const h = (tag, attrs, ...children) => { const el = new El(tag, attrs || {}); el.children = flat(children); return el; };
const kids = el => el.children.filter(c => c instanceof El);
const all = (el, pred, out = []) => { for (const c of kids(el)) { if (pred(c)) out.push(c); all(c, pred, out); } return out; };
const byClass = (el, cls) => all(el, c => c.className.split(/\s+/).includes(cls));
const tr = (s, args = []) => String(s).replace(/\{(\d)\}/g, (_, i) => String(args[i]));

const LISTS = [{ id: 'work', name: '업무', provider: 'local' }, { id: 'ms', name: 'Tasks', provider: 'microsoft' }];
function harness({ view, search = '', items = [], done = [], showDone = false }) {
  const context = {
    h, tr, view, search, showDone, isWidget: false, state: { accounts: [{ id: 'a' }], tasks: [] },
    smart: { today: { name: '오늘' }, planned: { name: '예정' }, all: { name: '전체' }, important: { name: '중요' } },
    smartColor: () => '#3478f6', listColor: () => '#3478f6', listVisual: l => ({ title: l.name }),
    listBy: id => LISTS.find(l => l.id === id), tasksFor: (v, isDone) => isDone ? done : items, rowHoldsSettle() {}, // no row held (2026-11-11 rowHolds)
    icon: name => h('i', { class: 'icon-' + name }), btn: (label, fn, cls) => h('button', { class: cls || 'button' }, label),
    openAccounts() {}, render() {}, taskDropEnd: box => box, taskDragStart: row => row, // a completed row drags to the sidebar too (2026-11-04)
    renderTaskList: list => list.map(t => h('div', { class: 'task-row' }, t.title)),
    taskRow: t => h('div', { class: 'task-row done' }, t.title), quickAdd: () => h('form', { class: 'quick-add' }),
    D: { dateKey: () => '2026-11-02' },
  };
  vm.createContext(context);
  vm.runInContext([appLine('const providerName='), appLine('const shortTitle='), appLine('function empty('), appLine('function tasksView(')].join('\n') + '\nthis.out=tasksView();', context);
  const out = context.out;
  return { out, caption: byClass(out, 'task-toolbar')[0].children[0], scroll: byClass(out, 'task-scroll')[0] };
}

test('a search that only matches completed tasks shows them first, with no 「no results」 above (usability-5)', () => {
  const { caption, scroll } = harness({ view: 'all', search: '셔츠', done: [{ title: '세탁소에서 셔츠 찾기' }] });
  assert.equal(caption.textContent, '모든 목록에서 1개');
  assert.equal(byClass(scroll, 'empty-state').length, 0, 'no empty state while a completed task matches');
  assert.equal(kids(scroll)[0].className, 'completed-section', 'the completed section is the first thing in the list');
  assert.equal(byClass(scroll, 'completed-section')[0].children[0].textContent, '완료한 할 일');
  // open and completed matches: the list as before, then the completed section
  const mixed = harness({ view: 'today', search: '부', items: [{ title: '부가세 신고' }], done: [{ title: '부모님 선물' }] });
  assert.equal(mixed.caption.textContent, '모든 목록에서 2개');
  assert.deepEqual(kids(mixed.scroll).map(c => c.className), ['task-list', 'completed-section']);
});

test('a search with no match shows one title line with the search term, no description (usability-5)', () => {
  const { caption, scroll } = harness({ view: 'all', search: 'zzzz' });
  // no 「모든 목록에서 0개」 over a title that already says so, and a magnifier rather than the 「all done」 check (2026-11-02 r60 integration app-ui-8)
  assert.equal(caption.textContent, '');
  const box = byClass(scroll, 'empty-state');
  assert.equal(box.length, 1);
  assert.equal(all(box[0], c => c.tag === 'i').map(c => c.attrs.class).join(), 'icon-search');
  assert.equal(all(box[0], c => c.tag === 'h2')[0].textContent, '「zzzz」에 맞는 할 일이 없어요');
  assert.equal(all(box[0], c => c.tag === 'p').length, 0, 'no description paragraph (an empty one would still take the gap)');
  assert.equal(all(box[0], c => c.tag === 'button').length, 0);
});

test('the toolbar has no standing caption; an account list still names its service (usability-8)', () => {
  for (const view of ['today', 'all', 'planned', 'important', 'work']) assert.equal(harness({ view, items: [{ title: 'x' }] }).caption.textContent, '', view);
  assert.equal(harness({ view: 'ms', items: [{ title: 'x' }] }).caption.textContent, 'Microsoft');
  // the caption box stays (tests/ui-smoke.cjs reads `.task-toolbar span` while searching); styles.css keeps its line height
  assert.equal(harness({ view: 'today' }).caption.tag, 'span');
  const css = fs.readFileSync(path.join(project, 'renderer/styles.css'), 'utf8');
  assert.match(css, /\.task-toolbar>span\{min-height:1\.5em\}/);
});

test('the empty notes screen is a title and one short line, no button; the trash link stays (usability-8)', () => {
  const trashLink = h('button', { class: 'trash-link' }, '최근 삭제한 메모');
  const context = { h, tr, icon: name => h('i', { class: 'icon-' + name }), trashLink };
  vm.createContext(context);
  vm.runInContext(appLine('function empty(') + '\nthis.out=(function(pool,inFolder,side){\n' + appLine('  if(!pool.length){const none') + '\n})([]);', context);
  const box = byClass(context.out, 'empty-state')[0];
  assert.equal(all(box, c => c.tag === 'h2')[0].textContent, '아직 메모가 없어요');
  const ps = all(box, c => c.tag === 'p');
  assert.deepEqual(ps.map(p => p.textContent), ['오른쪽 위 새 메모로 시작하세요.']);
  assert.deepEqual(all(box, c => c.tag === 'button'), [trashLink], 'only the 최근 삭제한 메모 link, no 「메모 추가」 button');
});

test('「완료 n개」 in a list or 오늘 whose tasks are all done shows the completed tasks first, not 「지금은 여유로운 하루」 above them (re-review of usability-5)', () => {
  for (const view of ['work', 'today']) {
    const shown = harness({ view, showDone: true, done: [{ title: '항공권 예약' }, { title: '숙소 예약' }] });
    assert.equal(byClass(shown.scroll, 'empty-state').length, 0, view + ': no empty state while the completed section is open');
    assert.deepEqual(kids(shown.scroll).map(c => c.className), ['completed-section'], view);
    assert.equal(byClass(shown.out, 'text-button')[0].textContent, '완료 숨기기', view);
    // 「완료 숨기기」 brings the empty state back, and the completed tasks go away
    const hidden = harness({ view, showDone: false, done: [{ title: '항공권 예약' }, { title: '숙소 예약' }] });
    assert.deepEqual(kids(hidden.scroll).map(c => c.className), ['empty-state'], view);
    assert.equal(all(byClass(hidden.scroll, 'empty-state')[0], c => c.tag === 'h2')[0].textContent, '지금은 여유로운 하루');
    assert.equal(byClass(hidden.out, 'text-button')[0].textContent, '완료 2개', view);
  }
  // nothing completed: 「완료 n개」 is not offered and the empty state stays, whatever showDone was left at in another view
  assert.deepEqual(kids(harness({ view: 'work', showDone: true }).scroll).map(c => c.className), ['empty-state']);
});

test('the no-match title names the search as typed; a blank search gets the neutral line, not empty brackets (re-review of usability-5)', () => {
  // matching (tasksFor) does not trim: 「마무리하기 」 with a trailing space does not match 「주간 보고서 마무리하기」, so the title must keep the space
  const trailing = harness({ view: 'all', search: '마무리하기 ' });
  assert.equal(all(byClass(trailing.scroll, 'empty-state')[0], c => c.tag === 'h2')[0].textContent, '「마무리하기 」에 맞는 할 일이 없어요');
  const blank = harness({ view: 'all', search: '  ' });
  assert.equal(all(byClass(blank.scroll, 'empty-state')[0], c => c.tag === 'h2')[0].textContent, '검색 결과가 없어요');
  assert.equal(all(byClass(blank.scroll, 'empty-state')[0], c => c.tag === 'p').length, 0);
});

test('a long search term is shortened in the no-match title and the title may wrap (2026-11-02 r60 carry-over T-1)', () => {
  // A pasted URL or token made the centred 20px h2 941px wide in a 600px box, cut at both ends, with a scrollbar under the list.
  const url = 'https://outlook.office.com/mail/inbox/id/AAQkADAwATM0MDAAMS1hYmQ2LTQ4ZjUtMDACLTAwCgAQAO';
  const long = harness({ view: 'all', search: url });
  const title = all(byClass(long.scroll, 'empty-state')[0], c => c.tag === 'h2')[0].textContent;
  const term = /^「(.*)」에 맞는 할 일이 없어요$/.exec(title)?.[1] ?? '';
  assert.ok(term.length > 0 && term.length <= 24, `the term between the brackets is at most 24 characters: 「${term}」 (${term.length})`);
  assert.equal(term, url.slice(0, 23) + '…');
  const css = fs.readFileSync(path.join(project, 'renderer/styles.css'), 'utf8');
  assert.match(css, /\.empty-state h2\{overflow-wrap:anywhere\}/, 'a long unbroken title wraps instead of overflowing');
});
