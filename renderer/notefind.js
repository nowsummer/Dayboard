'use strict';
// Finding words (2026-10-21 user requests: 「메모에서 찾기」 with Ctrl+F as in other Windows apps; 「달력에서도 검색」).
// Notes: a find bar over the open note marks every match — a layer behind the text box draws the marks, as a text box
// cannot colour its own text — and steps through them (Enter, Shift+Enter, ↑/↓); Esc closes it and selects the match.
// The notes list search shows each note's matching line, marked, and opening a note from it starts the find bar on the
// same words (Apple Notes). Loaded before app.js like calendar.js: app.js's globals are read only when these run.

let noteFind={open:false,query:'',index:0};
const findEscape=text=>String(text).replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
// Where `query` occurs in `text`, ignoring case, as places on the text itself ({at,length}), at most 2000. A case-folding
// pattern keeps the places on the original text (lowercasing a copy moved them after an 'İ', 2026-10-21 review).
function findRanges(text,query){const out=[];const q=String(query||'');if(!q)return out;let pattern;try{pattern=new RegExp(findEscape(q),'giu');}catch{return out;}const value=String(text||'');let m;while(out.length<2000&&(m=pattern.exec(value))){if(!m[0].length){pattern.lastIndex++;continue;}out.push({at:m.index,length:m[0].length});}return out;}
const findMatches=(text,query)=>findRanges(text,query).map(r=>r.at);
// Text with the matches wrapped in <mark> (the current one marked too), as nodes for h().
function markedText(text,query,current=-1){const value=String(text||'');const ranges=findRanges(value,query);if(!ranges.length)return [value];const out=[];let at=0;ranges.forEach((r,n)=>{if(r.at>at)out.push(value.slice(at,r.at));out.push(h('mark',{class:n===current?'current':null},value.slice(r.at,r.at+r.length)));at=r.at+r.length;});if(at<value.length)out.push(value.slice(at));return out;}
// The line of a note's text that holds the first match, shortened around it, for the list (… when it is not the start).
function matchLine(body,query){const value=String(body||'');const i=findMatches(value,query)[0];if(i===undefined)return null;const start=value.lastIndexOf('\n',i)+1;const end=(value.indexOf('\n',i)+1||value.length+1)-1;let line=value.slice(start,end);let from=start;if(i-start>40){from=i-20;line='…'+value.slice(from,end);}return {line,before:from>0&&start>0};}

const noteFindBody=()=>document.querySelector('#app .note-editor:not(.trashed) .note-body');
function noteFindBar(note){
  let enterAfter=null;
  const input=h('input',{class:'note-find-input',type:'text',placeholder:tr('메모에서 찾기'),'aria-label':tr('메모에서 찾기'),value:noteFind.query,'data-focus-key':'note-find',spellcheck:'false',autocomplete:'off',
    oninput:e=>{noteFind.query=e.target.value;noteFind.index=0;noteFind.keep=null;noteFindRefresh(true);},
    // The Enter that ends a Korean syllable comes while composing and no second one follows: it steps after compositionend.
    oncompositionend:()=>{if(enterAfter===null)return;setTimeout(()=>{if(enterAfter===null)return;const step=enterAfter;enterAfter=null;noteFindStep(step);},30);},
    onkeydown:e=>{if(e.key==='Enter'&&(e.isComposing||e.keyCode===229)){e.preventDefault();enterAfter=e.shiftKey?-1:1;return;}if(e.isComposing)return;enterAfter=null;if(e.key==='Enter'){e.preventDefault();noteFindStep(e.shiftKey?-1:1);}else if(e.key==='ArrowDown'){e.preventDefault();noteFindStep(1);}else if(e.key==='ArrowUp'){e.preventDefault();noteFindStep(-1);}else if(e.key==='Escape'){e.preventDefault();e.stopPropagation();noteFindClose(true);}}});
  return h('div',{class:'note-find',role:'search','data-note-id':note.id},icon('search',15),input,h('span',{class:'note-find-count','aria-live':'polite'}),ib('chevup',tr('이전 찾기')+' (Shift+Enter)',()=>noteFindStep(-1)),ib('chevdown',tr('다음 찾기')+' (Enter)',()=>noteFindStep(1)),ib('close',tr('찾기 닫기')+' (Esc)',()=>noteFindClose(true)));
}
// The layer of marks copies the text box's type and box exactly, so every mark sits under its letters.
const FIND_STYLE=['fontFamily','fontSize','fontWeight','fontStyle','lineHeight','letterSpacing','wordSpacing','paddingTop','paddingRight','paddingBottom','paddingLeft','borderTopWidth','borderRightWidth','borderBottomWidth','borderLeftWidth','boxSizing','whiteSpace','wordBreak','overflowWrap','tabSize','textIndent'];
function noteFindRefresh(scroll){
  const body=noteFindBody();const layer=document.querySelector('#app .note-highlights');const count=document.querySelector('#app .note-find-count');
  if(!body||!layer)return;
  const style=getComputedStyle(body);for(const key of FIND_STYLE)layer.style[key]=style[key];
  const matches=findMatches(body.value,noteFind.query);
  if(noteFind.index>=matches.length)noteFind.index=0;
  layer.replaceChildren(...markedText(body.value,noteFind.query,noteFind.index),'\n');
  if(count)count.textContent=noteFind.query?(matches.length?tr('{0}/{1}',[noteFind.index+1,matches.length]):tr('결과 없음')):'';
  const current=layer.querySelector('mark.current');
  if(scroll&&current){const top=current.offsetTop;if(top<body.scrollTop||top>body.scrollTop+body.clientHeight-current.offsetHeight*2)body.scrollTop=Math.max(0,top-body.clientHeight/3);}
  layer.scrollTop=body.scrollTop;
}
function noteFindStep(direction){const body=noteFindBody();if(!body)return;noteFind.keep=null;const matches=findMatches(body.value,noteFind.query);if(!matches.length)return;noteFind.index=((noteFind.index+direction)%matches.length+matches.length)%matches.length;noteFindRefresh(true);}
// Ctrl+F in 메모: the find bar on the open note, starting from the words selected in it (else the last ones).
function openNoteFind(){
  if(isWidget||view!=='notes'||notesTrash)return false;
  const note=state.notes.find(n=>n.id===activeNote&&!n.trashedAt);if(!note)return false;
  const body=noteFindBody();const picked=body&&document.activeElement===body&&body.selectionEnd>body.selectionStart?body.value.slice(body.selectionStart,body.selectionEnd):'';
  // Started from a selection: the query is the selected words and the place is that selection, not the first match.
  // A selection inside repeated text (ㅋㅋㅋ) may not start a match: the next match is marked and Esc gives the selection back.
  if(picked&&!picked.includes('\n')){noteFind.query=picked.slice(0,200).replace(/[\uD800-\uDBFF]$/,'');noteFind.open=true;const starts=findMatches(body.value,noteFind.query);const at=starts.indexOf(body.selectionStart);noteFind.index=at>=0?at:Math.max(0,starts.findIndex(s=>s>body.selectionStart));noteFind.keep=at>=0?null:{start:body.selectionStart,end:body.selectionEnd,noteId:activeNote,value:body.value};}
  else{noteFind.keep=null;if(!noteFind.open){noteFind.open=true;noteFind.index=0;}}
  renderMain();
  const input=document.querySelector('#app .note-find-input');input?.focus();input?.select();noteFindRefresh(true);
  return true;
}
// Esc: the bar closes and the text box gets the current match selected, as Notepad leaves it.
function noteFindClose(select){
  const body=noteFindBody();const ranges=body?findRanges(body.value,noteFind.query):[];const at=ranges[noteFind.index]?.at;const length=ranges[noteFind.index]?.length||0;
  const keep=noteFind.keep;noteFind.keep=null;noteFind.open=false;renderMain();
  const next=noteFindBody();if(!next)return;next.focus({preventScroll:true});
  // The selection comes back only to the very note and text it was taken from (another note opened, or typing, meanwhile).
  if(select&&keep&&keep.noteId===activeNote&&keep.value===next.value)next.setSelectionRange(keep.start,keep.end);
  else if(select&&at!==undefined){next.setSelectionRange(at,at+length);}
}
// After a render: the marks follow the text box (typing, autosave redraws, scroll positions put back).
function noteFindAfterRender(){if(noteFind.open&&document.querySelector('#app .note-highlights'))noteFindRefresh(false);}
