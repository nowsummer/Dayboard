'use strict';
// 2026-11-09 사용자 결정 V4 「풀기」: while a task search has words, nothing in the sidebar claims to be the place shown — the smart cards
// and the lists lose their fill (the results come from every list) —, the title's side line says the search and how many it found
// instead of today's date, and the 「새로운 할 일」 box is not offered (it was unclear which list it would add to). Read from the real
// renderer/app.js lines (one function per line). Asserts take strings and booleans only.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const I = require('../renderer/i18n.js');

const lines = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'app.js'), 'utf8').split(/\r?\n/);
const line = prefix => lines.find(l => l.startsWith(prefix)) || '';

test('V4: a search drops the sidebar selection, says “words” · N beside the title and hides the add box', () => {
  const side = line('function sidebar(');
  assert.equal(side.includes("class:'smart-tile'+(view===id&&!search?' selected':'')"), true, 'smart cards: no fill while searching');
  assert.equal(line('function listRow(').includes("class:'list-nav'+(view===l.id&&!search?' selected':'')"), true, 'lists: no fill while searching');
  assert.equal(side.includes('const was=Boolean(search);search=e.target.value;'), true, 'it is known when a search starts or ends');
  assert.equal(line('const searchFill=').startsWith("const searchFill=()=>document.querySelectorAll('.sidebar [data-nav]').forEach(n=>n.classList.toggle('selected',!search&&n.dataset.nav===view));"), true, 'one function gives the cards their fill back');
  assert.equal(side.includes("if(was!==Boolean(search))searchFill();renderMain();"), true, 'the fill follows the search without drawing the box again');
  // Review V4 follow-up: Esc in the box empties the search the same way, so the place shown is selected again at once.
  assert.equal(line("document.addEventListener('keydown',e=>{if(calendarKey(e))return;").includes("if(search){search='';input.value='';searchFill();renderMain();}"), true, 'Esc gives the fill back too');
  assert.equal(side.includes("'data-nav':id") && line('function listRow(').includes("'data-nav':l.id"), true);
  const bar = line('function viewToolbar(');
  assert.equal(bar.includes("search.trim()?tr('“{0}” · {1}개',[shortTitle(search.trim()),tasksFor(view,false,false).length+tasksFor(view,true,false).length]):koreanDate(D.dateKey())"), true, 'the date gives way to the search and its count');
  assert.equal(line('function tasksView(').includes(',search?null:quickAdd(view));}'), true, 'no 새로운 할 일 under the results');
  I.setLanguage('en'); try { assert.equal(I.tr('“{0}” · {1}개', ['milk', 3]), '“milk” · 3 found'); } finally { I.setLanguage('ko'); }
});

test('a search of spaces only: no empty quotes beside the title, and the sidebar lets go as the results do (Argon review 2026-11-09 G2)', () => {
  const { harness } = require('./r50-F-harness.cjs');
  const h = harness({
    view: 'all', search: '   ', smart: { all: { name: '전체' } }, listBy: () => null, smartColor: () => '#3478f6', listVisual: () => ({ title: '' }), listColor: () => '#3478f6',
    openWidgetFlow() {}, openingWidget: false, appTheme: () => 'light', taskCount: () => 2, shortTitle: s => s, tasksFor: () => [{}], koreanDate: () => '11월 9일 월요일',
    taskSortable: () => false, calendarToolbar: () => [], ctxToggleButton: () => null, noteFoldersToggle() {}, noteSortMenu() {}, newNote() {}, notesTrash: false, noteFolder: null,
  });
  h.loadApp('const searchFill=', 'function viewToolbar(');
  const parts = [...h.eval('viewToolbar')()].filter(Boolean);
  const date = parts.find(n => n.className === 'topbar-date');
  assert.equal(date.textContent.includes('“”'), false, 'no empty quotes: ' + date.textContent);
  assert.equal(date.textContent, '11월 9일 월요일');
  const sidebar = h.document.createElement('aside'); sidebar.className = 'sidebar';
  const tile = h.document.createElement('button'); tile.className = 'smart-tile selected'; tile.dataset.nav = 'all';
  sidebar.appendChild(tile); h.document.body.appendChild(sidebar);
  h.eval('searchFill')();
  assert.equal(tile.classList.contains('selected'), false, 'the results come from every list while the search box holds anything');
  h.eval('search = ""');
  h.eval('searchFill')();
  assert.equal(tile.classList.contains('selected'), true, 'an empty box gives the place shown its fill back');
});
