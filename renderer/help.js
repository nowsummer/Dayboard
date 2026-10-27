'use strict';
// Help (2026-10-21 user requests): 「노션 캘린더처럼… 구석에 동그라미 물음표를 작게 놔두고 마우스 가져다 대면 유용한 단축키」 and
// 「처음 쓰는 사람한테 기능 등 소개하는 튜토리얼」. A small ? at the foot of the sidebar shows the useful shortcuts of the screen in
// view on hover (a click keeps it open), with every shortcut (also the ? key) and the tour below it. The tour opens once for a
// new user (nothing in Dayboard yet, settings.tourDone) and lights up the real parts of the window one by one.
// Loaded before app.js like calendar.js: app.js's globals are read only when these functions run.

// ---- Shortcuts ----
// A shortcut lists key combinations shown as alternatives: [['Ctrl','F'],['Ctrl','K']] reads Ctrl F / Ctrl K.
function helpKeys(combos){return h('span',{class:'keys'},combos.map((combo,i)=>[i?h('span',{class:'keys-or'},'/'):null,combo.map(k=>h('kbd',{},k))]));}
function shortcutGroups(){
  return [
    [tr('어디서나'),[
      [tr('검색'),[['Ctrl','F'],['Ctrl','K']]],
      [tr('새로 만들기(보는 화면에 맞게)'),[['Ctrl','N']]],
      [tr('방금 한 일 되돌리기'),[['Ctrl','Z']]],
      [tr('다시 실행'),[['Ctrl','Shift','Z'],['Ctrl','Y']]],
      [tr('닫기·취소'),[['Esc']]],
      [tr('키보드 단축키 보기'),[['?']]]]],
    [tr('할 일'),[
      [tr('입력한 할 일 추가'),[['Enter']]],
      [tr('고른 할 일 삭제'),[['Delete']]]]],
    [tr('달력'),[
      [tr('오늘로 이동'),[['T'],['Ctrl','T']]],
      [tr('날짜로 이동'),[['Ctrl','Shift','T']]],
      [tr('일·주·월 보기'),[['D'],['W'],['M']]],
      [tr('다음 기간'),[['J'],['→']]],
      [tr('이전 기간'),[['K'],['←']]],
      [tr('월간에서 한 주씩'),[['↑'],['↓']]],
      [tr('새 일정'),[['C']]],
      [tr('오른쪽 패널'),[['\\']]],
      [tr('고른 일정 삭제'),[['Delete']]]]],
    [tr('메모'),[
      [tr('메모 안에서 찾기'),[['Ctrl','F']]],
      [tr('다음·이전 찾기'),[['Enter'],['Shift','Enter']]],
      [tr('메모 목록 검색'),[['Ctrl','K']]],
      [tr('실행 취소'),[['Ctrl','Z']]],
      [tr('다시 실행'),[['Ctrl','Shift','Z'],['Ctrl','Y']]],
      [tr('고른 메모 삭제'),[['Delete']]]]],
  ];
}
// The few that matter on the screen in view (Notion Calendar's 「유용한 단축키」).
function usefulShortcuts(){
  if(view==='calendar')return [[tr('오늘로 이동'),[['T']]],[tr('날짜로 이동'),[['Ctrl','Shift','T']]],[tr('일·주·월 보기'),[['D'],['W'],['M']]],[tr('다음·이전 기간'),[['J'],['K']]],[tr('새 일정'),[['C']]],[tr('일정 검색'),[['Ctrl','F']]]];
  if(view==='notes')return [[tr('새 메모'),[['Ctrl','N']]],[tr('메모 안에서 찾기'),[['Ctrl','F']]],[tr('메모 목록 검색'),[['Ctrl','K']]],[tr('실행 취소'),[['Ctrl','Z']]]];
  return [[tr('새 할 일'),[['Ctrl','N']]],[tr('할 일 검색'),[['Ctrl','F']]],[tr('고른 할 일 삭제'),[['Delete']]],[tr('방금 한 일 되돌리기'),[['Ctrl','Z']]]];
}
function openShortcuts(){
  helpClose();
  modal(tr('키보드 단축키'),h('div',{class:'dialog-body shortcuts-body'},shortcutGroups().map(([title,rows])=>h('section',{class:'shortcut-group'},h('h3',{},title),h('dl',{},rows.map(([label,combos])=>h('div',{class:'shortcut-row'},h('dt',{},label),h('dd',{},helpKeys(combos)))))))),true);
}

// ---- The ? button and its card ----
let helpPop=null,helpTimer=null,helpPointer=false; // the ? pressed with the mouse: no focus ring comes back to it afterwards (2026-10-26 review)
function helpButton(){
  return h('button',{type:'button',class:'icon-button help-button'+(helpPop?' active':''),'aria-label':tr('단축키와 도움말'),'aria-haspopup':'dialog','aria-expanded':String(Boolean(helpPop)),'data-focus-key':'help',
    onpointerenter:()=>helpHover(true),onpointerleave:()=>helpHover(false),onpointerdown:()=>{helpPointer=true;},onclick:()=>{const kb=!helpPointer;helpPointer=false;if(helpPop?.pinned)helpClose();else helpOpen(true,kb);}},icon('help',18));
}
function helpHover(inside){clearTimeout(helpTimer);if(inside){if(!helpPop)helpTimer=setTimeout(()=>helpOpen(false),150);}else if(helpPop&&!helpPop.pinned)helpTimer=setTimeout(helpClose,250);}
function helpOpen(pinned,kb=false){
  clearTimeout(helpTimer);
  if(helpPop){if(pinned&&!helpPop.pinned){helpPop.pinned=true;helpPop.kb=kb;if(kb)helpPop.node.querySelector('.help-link')?.focus({preventScroll:true});}return;}
  if(tour||$('#modal-root .dialog'))return;
  const button=document.querySelector('#app .help-button');if(!button)return;
  closeMenu();
  const node=h('div',{class:'help-pop',role:'dialog','aria-label':tr('유용한 단축키'),onpointerenter:()=>clearTimeout(helpTimer),onpointerleave:()=>helpHover(false)},
    h('h3',{},tr('유용한 단축키')),
    h('ul',{class:'help-rows'},usefulShortcuts().map(([label,combos])=>h('li',{},h('span',{},label),helpKeys(combos)))),
    h('hr'),
    h('button',{type:'button',class:'help-link',onclick:openShortcuts},h('span',{},tr('모든 키보드 단축키')),helpKeys([['?']])),
    h('button',{type:'button',class:'help-link',onclick:()=>tourStart(false)},h('span',{},tr('기능 둘러보기'))));
  document.body.append(node);
  helpPop={node,pinned,kb};
  helpPlace();
  document.addEventListener('mousedown',helpOutside,true);document.addEventListener('keydown',helpKey,true);document.addEventListener('focusin',helpFocus,true);window.addEventListener('resize',helpClose);window.addEventListener('blur',helpClose);
  helpMark();
  if(pinned&&kb)node.querySelector('.help-link')?.focus({preventScroll:true});
}
// Focus that moves away from the card and the ? (Ctrl+F, Ctrl+N, C, Tab) closes it, so the next Esc belongs to what has focus.
function helpFocus(e){if(helpPop&&!helpPop.node.contains(e.target)&&!e.target.closest?.('.help-button'))helpClose();}
function helpPlace(){const button=document.querySelector('#app .help-button');if(!helpPop||!button)return;const r=button.getBoundingClientRect(),n=helpPop.node;n.style.left=Math.max(8,Math.min(r.left-8,innerWidth-n.offsetWidth-8))+'px';n.style.bottom=Math.max(8,innerHeight-r.top+8)+'px';}
function helpClose(){
  clearTimeout(helpTimer);if(!helpPop)return;
  const hadFocus=helpPop.node.contains(document.activeElement),kb=helpPop.kb;
  helpPop.node.remove();helpPop=null;
  document.removeEventListener('mousedown',helpOutside,true);document.removeEventListener('keydown',helpKey,true);document.removeEventListener('focusin',helpFocus,true);window.removeEventListener('resize',helpClose);window.removeEventListener('blur',helpClose);
  helpMark();
  if(hadFocus){if(kb)document.querySelector('#app .help-button')?.focus({preventScroll:true});else document.activeElement?.blur?.();}
}
function helpOutside(e){if(helpPop&&!helpPop.node.contains(e.target)&&!e.target.closest?.('.help-button'))helpClose();}
// Esc is the card's only while focus is on it or on the ?; otherwise the card just goes and the key reaches the search box or card.
function helpKey(e){
  if(e.key!=='Escape'||!helpPop)return;
  const a=document.activeElement;
  if(!helpPop.node.contains(a)&&!a?.closest?.('.help-button')){helpClose();return;}
  e.preventDefault();e.stopPropagation();const pinned=helpPop.pinned,kb=helpPop.kb;helpClose();if(pinned&&kb)document.querySelector('#app .help-button')?.focus({preventScroll:true});else document.activeElement?.blur?.();
}
function helpMark(){const button=document.querySelector('#app .help-button');if(!button)return;button.classList.toggle('active',Boolean(helpPop));button.setAttribute('aria-expanded',String(Boolean(helpPop)));}

// ---- The tour ----
let tour=null;
function tourSteps(){
  return [
    {target:null,title:tr('Dayboard에 오신 걸 환영해요'),text:tr('할 일·달력·메모를 한 창에서 보고, 바탕화면에도 놓을 수 있어요.')},
    {target:'.smart-grid',title:tr('스마트 목록'),text:tr('오늘·예정·전체·중요 할 일을 한곳에 모아 봐요.')},
    {target:'.quick-add',view:'today',title:tr('빠른 추가'),text:tr('「내일 오후 3시 회의」처럼 쓰면 날짜와 알림이 함께 들어가요.')},
    {target:'.main-nav .nav-item:nth-child(2)',title:tr('달력'),text:tr('일·주·월로 보고, 일정을 끌어서 옮기거나 늘려요.')},
    {target:'.main-nav .nav-item:nth-child(3)',title:tr('메모'),text:tr('생각을 적고 Ctrl+F로 찾아요. 고정과 이전 버전도 있어요.')},
    {target:'.main-nav .nav-item:nth-child(4)',title:tr('바탕화면 위젯'),text:tr('할 일·달력·메모를 바탕화면에 놓아 늘 볼 수 있어요.')},
    {target:'.account-button',title:tr('계정 연결'),text:tr('Outlook·Google·iCloud의 할 일과 달력을 함께 봐요.')},
    {target:'.help-button',title:tr('단축키와 도움말'),text:tr('여기에 마우스를 올리면 단축키가 보여요. 둘러보기도 여기서 다시 볼 수 있어요.')},
  ];
}
// A new user: nothing in Dayboard yet — no account, task, note, event, widget or list of their own (an existing user is
// never interrupted, even one who only keeps events or lists; the ? has the tour).
const tourFresh=s=>Boolean(s)&&!(s.accounts||[]).length&&!(s.tasks||[]).length&&!(s.notes||[]).some(n=>!n.trashedAt)&&!(s.events||[]).length&&!(s.widgets||[]).length&&!(s.lists||[]).some(l=>l.id!=='local-inbox');
function tourMaybeStart(){if(isWidget||tour||!state||state.settings.tourDone||$('#modal-root .dialog')||!tourFresh(state))return false;tourStart(true);return true;}
function tourRootNode(){let root=document.getElementById('tour-root');if(!root){root=h('div',{id:'tour-root',hidden:''});document.body.append(root);}return root;}
function tourStart(auto=false){
  if(isWidget)return;
  // A repeating event's card with unsaved changes asks how far they apply first; the tour waits rather than removing that
  // question (Codex review: closing it unanswered left the card stuck in 'closing').
  helpClose();closeMenu();if(typeof closeCard==='function'&&!closeCard(true))return;
  if($('#modal-root .dialog'))return;
  tour={i:0,auto,steps:tourSteps(),from:view,fromList:lastTaskView,fromSearch:search,kb:false};
  document.addEventListener('keydown',tourKey,true);window.addEventListener('resize',tourPlace);
  tourShow();
}
// The step's element, or null when it is not on screen (also when scrolled out of the sidebar's list).
function tourTarget(step){
  const t=step.target?document.querySelector('#app '+step.target):null;
  if(!t||!t.getClientRects().length)return null;
  const box=t.closest('.sidebar-scroll');if(!box)return t;
  const r=t.getBoundingClientRect(),b=box.getBoundingClientRect();
  return r.top>=b.top-1&&r.bottom<=b.bottom+1?t:null;
}
function tourShow(){
  if(!tour)return;
  const step=tour.steps[tour.i];const first=tour.i===0,last=tour.i===tour.steps.length-1;
  if(step.view&&!isTaskView(view))goto(step.view);
  const el=step.target?document.querySelector('#app '+step.target):null;
  if(el&&el.closest('.sidebar-scroll'))el.scrollIntoView({block:'nearest'});
  // The card itself takes focus (no ring for a mouse user); keys still work, Tab reaches the buttons.
  const card=h('div',{class:'tour-card'+(step.target?'':' welcome'),role:'dialog','aria-modal':'true','aria-labelledby':'tour-title','aria-describedby':'tour-text',tabindex:'-1'},
    first?h('img',{class:'tour-mark',src:'../assets/icon.png',width:56,height:56,alt:''}):h('p',{class:'tour-count'},tr('{0} / {1}',[tour.i,tour.steps.length-1])),
    h('h2',{id:'tour-title'},step.title),h('p',{id:'tour-text',class:'tour-text'},step.text),
    h('footer',{class:'tour-actions'},
      h('button',{type:'button',class:'text-button tour-skip',onclick:()=>tourEnd()},tr('건너뛰기')),
      h('span',{class:'tour-nav'},first?null:btn(tr('이전'),()=>tourGo(-1),'button subtle'),btn(first?tr('둘러보기'):last?tr('시작하기'):tr('다음'),()=>(last?tourEnd():tourGo(1)),'button primary'))));
  const root=tourRootNode();
  root.replaceChildren(...[h('div',{class:'tour-shade'+(step.target?' clear':''),onmousedown:e=>e.preventDefault()}),step.target?h('div',{class:'tour-hole'}):null,card].filter(Boolean)); // never null: replaceChildren writes it as text
  root.hidden=false;$('#app').inert=true;
  tourPlace();
  (tour.kb?card.querySelector('.button.primary'):card).focus({preventScroll:true});
}
// The lit part follows its element (a redraw, a resized window); a missing element shows the card in the middle.
function tourPlace(){
  if(!tour)return;const root=document.getElementById('tour-root');const card=root?.querySelector('.tour-card');if(!card)return;
  const step=tour.steps[tour.i];const target=tourTarget(step);const hole=root.querySelector('.tour-hole');
  const w=card.offsetWidth,hgt=card.offsetHeight,gap=16,edge=12;
  if(!target){if(hole)hole.style.display='none';card.style.left=Math.max(edge,(innerWidth-w)/2)+'px';card.style.top=Math.max(edge,(innerHeight-hgt)/2)+'px';return;}
  const r=target.getBoundingClientRect(),pad=6;
  if(hole){hole.style.display='';Object.assign(hole.style,{left:(r.left-pad)+'px',top:(r.top-pad)+'px',width:(r.width+pad*2)+'px',height:(r.height+pad*2)+'px'});}
  let x=r.right+pad+gap,y=r.top+r.height/2-hgt/2;
  if(x+w>innerWidth-edge){x=Math.min(Math.max(edge,r.left),innerWidth-w-edge);y=r.bottom+pad+gap;if(y+hgt>innerHeight-edge)y=r.top-pad-gap-hgt;}
  card.style.left=Math.round(Math.max(edge,x))+'px';card.style.top=Math.round(Math.max(edge,Math.min(y,innerHeight-hgt-edge)))+'px';
}
function tourGo(d){if(!tour)return;tour.i=Math.max(0,Math.min(tour.steps.length-1,tour.i+d));tourShow();}
function tourKey(e){
  if(!tour)return;
  const card=document.querySelector('#tour-root .tour-card');
  if(!['Shift','Control','Alt','Meta'].includes(e.key))tour.kb=true;
  if(e.key==='Escape'){e.preventDefault();tourEnd();}
  else if(e.key==='ArrowRight'){e.preventDefault();if(tour.i<tour.steps.length-1)tourGo(1);}
  else if(e.key==='ArrowLeft'){e.preventDefault();tourGo(-1);}
  else if(e.key==='Tab'&&card){const els=[...card.querySelectorAll('button')];const a=document.activeElement;if(!card.contains(a)){e.preventDefault();els[0]?.focus();}else if(e.shiftKey&&a===els[0]){e.preventDefault();els.at(-1)?.focus();}else if(!e.shiftKey&&a===els.at(-1)){e.preventDefault();els[0]?.focus();}}
  else if(e.key==='Enter'&&card&&(document.activeElement===card||!card.contains(document.activeElement))){e.preventDefault();card.querySelector('.button.primary')?.click();}
  e.stopPropagation(); // the app's own shortcuts wait while the tour is open
}
// The tour ends where it started (step 2 goes to 할 일); skipped before its last step it says where it lives.
function tourEnd(){
  if(!tour)return;
  const {from,fromList,fromSearch,kb}=tour,early=tour.i<tour.steps.length-1;
  tour=null;
  document.removeEventListener('keydown',tourKey,true);window.removeEventListener('resize',tourPlace);
  const root=document.getElementById('tour-root');if(root){root.replaceChildren();root.hidden=true;}
  if(!$('#modal-root .dialog'))$('#app').inert=false;
  // Back where it started, with the 할 일 tab's list and the search text as they were (step 2 visits 오늘).
  if(from&&view!==from){goto(from);if(fromList)lastTaskView=fromList;if(fromSearch){search=fromSearch;render();}}
  if(!state.settings.tourDone)run('settings:update',{tourDone:true}).catch(()=>{});
  if(early)toast(tr('둘러보기는 왼쪽 아래 ? 에서 다시 볼 수 있어요.'));
  if(kb)document.querySelector('#app .help-button')?.focus({preventScroll:true});
  else document.activeElement?.blur?.();
}
// After a redraw: the ? shows its state, the tour keeps the app out of reach and follows its element; a welcome that opened by
// itself goes when the setting says the tour was done meanwhile (another window, or a profile filled by a script).
function helpAfterRender(){
  helpMark();
  if(!tour)return;
  if(tour.auto&&tour.i===0&&state.settings.tourDone){tourEnd();return;}
  $('#app').inert=true;tourPlace();
}
