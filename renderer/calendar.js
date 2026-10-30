'use strict';
// Calendar screen (2026-10-21 user requests, Notion Calendar as the model): month, week and day views; the right panel that
// folds away; dragging events to move or stretch them and drawing new ones; the event card that opens beside an event.
// Loaded before app.js as a classic script. Nothing here runs at load time except declarations and window listeners, so
// app.js's globals (state, h, tr, D, I, run, render, month, selectedDate, …) are in place whenever these functions run.

// ---- State kept for this window session ----
let calTop=null;                     // month view: Sunday that starts the first row (null: the week holding the 1st of month)
const calScroll={week:null,day:null};// time grid scroll position per view
let calRecenter=true;                // the next time grid render scrolls to the current time (first open, 오늘, T)
let calGesture=null;                 // pointer gesture in progress (move, stretch, draw)
let calPanelDragging=false;          // the day panel's edge held (calPanelResizer): a render waits for the release (2026-10-30 Codex review R03)
let calDrawer=false;                 // narrow window: the day panel shown over the calendar
let calAllDayOpen=false;             // all-day row shows every lane
let calHour=48;                      // hour height in px (12 hours per screen, at least 40px)
let calDraft=null;                   // new event being drawn or edited in the card: {start,end,allDay}
let calCard=null;                    // the open event card
let calSuppressClick=0;              // clicks right after a drag or after closing the card do nothing
const CAL_PANEL_MIN=900;             // the panel docks when the calendar area is this wide (the default 1180px window keeps it)
const CAL_STEP=15;                   // minutes: every drag and time list snaps to this

const calMode=()=>['month','week','day'].includes(state?.settings?.calendarView)?state.settings.calendarView:'month';
const calDays=()=>calMode()==='day'?[selectedDate]:D.weekDays(selectedDate);
const calMonthKey=d=>d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0');
const calFieldFocused=()=>{const a=document.activeElement;return Boolean(a&&(['INPUT','TEXTAREA','SELECT'].includes(a.tagName)||a.isContentEditable||a.closest?.('select')));};/* an option of an open drop-down menu is its select (area H: a save that lands while the menu is open does not re-draw the card under it) */
function calSyncMonth(){const d=D.fromDate(selectedDate);month=new Date(d.getFullYear(),d.getMonth(),1);calTop=null;}

// ---- Views and navigation ----
function setCalMode(mode,day){if(!['month','week','day'].includes(mode))return;if(!closeCard(true))return;if(day){selectedDate=day;calSyncMonth();}if(mode!=='month'&&calMode()==='month'&&!day){const visible=D.cellsFrom(calStart());if(!visible.some(c=>c.key===selectedDate))selectedDate=visible.find(c=>!c.outside).key;}state.settings.calendarView=mode;render();run('settings:update',{calendarView:mode}).catch(()=>{});}
function calendarStep(n){closeCard(true);const mode=calMode();if(mode==='month'){month=new Date(month.getFullYear(),month.getMonth()+n,1);calTop=null;render();return;}selectedDate=D.dayOffset(selectedDate,(mode==='week'?7:1)*n);calSyncMonth();render();}
// Month view rows: a rolling run of six weeks that the wheel moves a week at a time; month (the title) follows the rows.
// 「날짜로 이동」 (Apple Calendar ⌘⇧T): one box read as it is typed — 2027-3-15, 3월 15일, 11/3, 2027년 1월, 다음 주 금요일, Nov 3.
// The day it reads is shown under the box; Enter goes there in the current view (the day becomes the selected day).
function calGoToDate(){
  if(isWidget||view!=='calendar'||$('#modal-root .dialog'))return;
  if(!closeCard(true))return;
  const input=h('input',{class:'form-input',type:'text',maxlength:60,autocomplete:'off',spellcheck:'false','aria-label':tr('날짜'),placeholder:tr('예: 11/3, 2027년 1월, 다음 주 금요일')});
  const hint=h('p',{class:'field-help go-date-hint','aria-live':'polite'});
  const read=()=>D.parseGoDate(input.value,D.dateKey());
  // Half-typed text is not an error (「2027-」, a syllable being composed): the line turns red only after Enter could not read it
  // (2026-10-27 review).
  let failed=false;
  const show=()=>{const typed=input.value.trim(),key=read(),bad=failed&&Boolean(typed)&&!key;hint.textContent=key?calLongDate(key):bad?tr('날짜를 알아보지 못했어요.'):tr('오늘: {0}',[calLongDate(D.dateKey())]);hint.classList.toggle('error',bad);};
  input.addEventListener('input',()=>{failed=false;show();});show();
  const form=h('form',{class:'dialog-body go-date',onsubmit:ev=>{ev.preventDefault();const key=read();if(!key){failed=true;show();input.focus();return;}closeModal();calJumpTo(key);}},input,hint,actionFooter(()=>closeModal(),tr('이동')));
  modal(tr('날짜로 이동'),form,false,{live:true});
}
const calLongDate=key=>D.fromDate(key).toLocaleDateString(I.locale(),{year:'numeric',month:'long',day:'numeric',weekday:'long'});
function calJumpTo(key){selectedDate=key;calSyncMonth();render();}
function calStart(){const aligned=D.monthStart(month);if(!calTop)return aligned;const focus=D.cellsFrom(calTop).find(c=>!c.outside).key.slice(0,7);return focus===calMonthKey(month)?calTop:aligned;}
function calWeekStep(n){const top=D.dayOffset(calStart(),7*n);const focus=D.cellsFrom(top).find(c=>!c.outside).key;calTop=top;month=new Date(Number(focus.slice(0,4)),Number(focus.slice(5,7))-1,1);closeCard(true);render();return top;}
function calendarTitle(){const mode=calMode();if(mode==='month')return month.toLocaleDateString(I.locale(),{year:'numeric',month:'long'});if(mode==='day'){const d=D.fromDate(selectedDate);return d.toLocaleDateString(I.locale(),{...(d.getFullYear()===new Date().getFullYear()?{}:{year:'numeric'}),month:'long',day:'numeric',weekday:'short'});}// Week: the month (Notion), or both months when the week crosses into the next one — the top bar stays short.
const days=D.weekDays(selectedDate),a=D.fromDate(days[0]),b=D.fromDate(days[6]);const fmt={year:'numeric',month:'long'};if(a.getMonth()===b.getMonth())return a.toLocaleDateString(I.locale(),fmt);/* two months: short names (「Sep – Oct 2026」; Korean is short anyway) — the long ones were cut at 900px (2026-10-27 recheck) */const range={year:'numeric',month:'short'};try{return new Intl.DateTimeFormat(I.locale(),range).formatRange(a,b);}catch{return b.toLocaleDateString(I.locale(),range);}}
function calendarToolbar(){
  const mode=calMode(),spacer=h('span',{class:'topbar-spacer'});
  const labels={month:[tr('이전 달'),tr('다음 달')],week:[tr('이전 주'),tr('다음 주')],day:[tr('이전 날'),tr('다음 날')]}[mode];
  const names={day:tr('일간 보기'),week:tr('주간 보기'),month:tr('월간 보기')};
  // One Tab stop (the view in use); ← → ↑ ↓ change the view and keep the keyboard on it (2026-10-28 Codex review D09, C3: all three
  // were stops and the arrows did nothing). radioKeys stops the arrows here, so they never move the calendar's day. The keyboard
  // goes to the view in use afterwards, which is the old one when a card's open repeat question holds the change (setCalMode).
  const modes=['day','week','month'];
  const switcher=h('div',{class:'view-switch',role:'radiogroup','aria-label':tr('달력 보기')},[['day',tr('일'),'D'],['week',tr('주'),'W'],['month',tr('월'),'M']].map(([m,label,key],i)=>h('button',{type:'button',class:'view-switch-item'+(m===mode?' on':''),role:'radio','aria-checked':m===mode,tabindex:m===mode?0:-1,'aria-label':names[m],title:names[m]+' ('+key+')','data-focus-key':'view-'+m,onclick:()=>setCalMode(m),onkeydown:e=>radioKeys(e,modes.length,i,to=>{setCalMode(modes[to]);document.querySelector('.view-switch [aria-checked="true"]')?.focus({preventScroll:true});})},label)));
  const open=calPanelDocked()||calDrawer;
  // The title opens 「날짜로 이동」 (Apple Calendar's Go to Date, ⌘⇧T there), as clicking the month in Notion Calendar does. A small
  // muted chevron inside the same button says so (2026-10-28 Codex review D10, C4: it read as a plain heading); when the bar is
  // tight the chevron gives way first, then the text takes its ellipsis (styles.css).
  return [h('h1',{},h('button',{type:'button',class:'title-button','aria-label':calendarTitle()+', '+tr('날짜로 이동'),title:tr('날짜로 이동')+' (Ctrl+Shift+T)','data-focus-key':'go-date',onclick:calGoToDate},h('span',{class:'title-text'},calendarTitle()),icon('chevdown',14))),h('div',{class:'inline-actions month-nav'},keyed(ib('left',labels[0],()=>calendarStep(-1)),'month-prev','Ctrl+←'),keyed(ib('right',labels[1],()=>calendarStep(1)),'month-next','Ctrl+→')),keyed(btn(tr('오늘'),goToday,'button subtle'),'month-today','T'),spacer,switcher,keyed(ib('panel',open?tr('오른쪽 패널 숨기기'):tr('오른쪽 패널 보이기'),calTogglePanel,'panel-toggle'+(open?' active':'')),'panel-toggle','\\'),keyed((b=>{b.setAttribute('aria-label',tr('일정 추가'));return b;})(btn(h('span',{class:'button-label'},tr('일정 추가')),()=>addEvent(selectedDate),'button primary event-add-button','plus')),'event-add','C')];
}

// ---- The right panel: docked on a wide calendar, otherwise a drawer over it (Notion 2026-01-20) ----
function calAreaWidth(){const side=document.querySelector('.sidebar');return innerWidth-(side?side.offsetWidth:244);}
const calPanelDocked=()=>state.settings.calendarPanel!=='closed'&&calAreaWidth()>=CAL_PANEL_MIN;
function calTogglePanel(){closeCard(true);if(calPanelDocked()){state.settings.calendarPanel='closed';calDrawer=false;render();run('settings:update',{calendarPanel:'closed'}).catch(()=>{});return;}if(calAreaWidth()>=CAL_PANEL_MIN){state.settings.calendarPanel='auto';calDrawer=false;render();run('settings:update',{calendarPanel:'auto'}).catch(()=>{});return;}calDrawer=!calDrawer;render();}
function calOpenPanelFor(day){selectedDate=day;calSyncMonth();if(!calPanelDocked())calDrawer=true;render();}
function dayPanel(drawer){const dayTasks=state.tasks.filter(t=>t.dueDate===selectedDate&&!t.completed);return h('aside',{class:'day-panel'+(drawer?' drawer':''),'aria-label':tr('날짜 패널')},h('div',{class:'context-heading'},h('h3',{},koreanDate(selectedDate)),ib('plus',tr('이날 일정 추가'),e=>addEvent(selectedDate,e.currentTarget))),agenda(selectedDate),h('h4',{class:'agenda-sub'},tr('할 일')),dayTasks.length?h('div',{},dayTasks.map(t=>taskRow(t,true,selectedDate))):h('p',{class:'no-events'},tr('정해진 할 일이 없어요')),quickAdd(lastTaskView,true,selectedDate),calendarList());}
// The docked panel's edge takes a drag (2026-10-29 owner: 「분계선 선을 잡고 원하는 크기 만큼 좁히거나」), as Notion Calendar's and
// Finder's sidebars do: the width follows the pointer live (a CSS variable, no redraw), is saved on release (settings.calendarPanelWidth,
// domain.js CAL_PANEL_WIDTH 220–480 and never more than 42% of the calendar, styles.css), a double-click gives back the width that
// follows the window, and ←/→ move it by 16px from the keyboard. Only the docked panel: the drawer of a narrow window keeps its 300px.
function calPanelWidth(){const w=state.settings.calendarPanelWidth;return Number.isFinite(w)?w:null;}
function calPanelSave(width){const w=width==null?null:D.panelWidth(width);if(w===(calPanelWidth()??null))return;state.settings.calendarPanelWidth=w;run('settings:update',{calendarPanelWidth:w}).catch(()=>{});render();}
function calPanelResizer(){const set=(view,w)=>{view.classList.add('panel-sized');view.style.setProperty('--cal-panel',w+'px');};const shown=()=>Math.round(document.querySelector('.calendar-view>.day-panel')?.getBoundingClientRect().width||calPanelWidth()||264);const grip=h('div',{class:'cal-panel-resizer',role:'separator','aria-orientation':'vertical','aria-label':tr('패널 너비'),'aria-valuemin':D.CAL_PANEL_WIDTH.min,'aria-valuemax':D.CAL_PANEL_WIDTH.max,'aria-valuenow':calPanelWidth(),tabindex:0,title:tr('끌어서 너비 조절 · 두 번 눌러 원래대로'),ondblclick:()=>calPanelSave(null),onkeydown:e=>{const step={ArrowLeft:16,ArrowRight:-16}[e.key];if(!step)return;e.preventDefault();e.stopPropagation();calPanelSave(shown()+step);requestAnimationFrame(()=>document.querySelector('.cal-panel-resizer')?.focus());},onpointerdown:e=>{if(e.button!==0)return;e.preventDefault();const view=grip.closest('.calendar-view');const startX=e.clientX,startW=shown();let w=startW,done=false;grip.setPointerCapture(e.pointerId);calPanelDragging=true;grip.classList.add('dragging');document.body.classList.add('col-resizing');const move=ev=>{w=D.panelWidth(startW+(startX-ev.clientX));set(view,w);};const up=()=>{if(done)return;done=true;grip.removeEventListener('pointermove',move);grip.removeEventListener('pointerup',up);grip.removeEventListener('pointercancel',up);grip.removeEventListener('lostpointercapture',up);grip.classList.remove('dragging');document.body.classList.remove('col-resizing');calPanelDragging=false;const pending=renderPending,before=calPanelWidth();renderPending=false;if(w!==startW)calPanelSave(Math.round(document.querySelector('.calendar-view>.day-panel')?.getBoundingClientRect().width||w));if(pending&&calPanelWidth()===before)render();};grip.addEventListener('pointermove',move);grip.addEventListener('pointerup',up);grip.addEventListener('pointercancel',up);grip.addEventListener('lostpointercapture',up);}});return grip;}
function calendarScreen(){const docked=calPanelDocked();if(docked)calDrawer=false;const drawer=!docked&&calDrawer;const sized=docked&&calPanelWidth()!=null;return h('section',{class:'calendar-view'+(docked?'':' panel-hidden')+(drawer?' drawer-open':'')+(sized?' panel-sized':''),style:sized?{'--cal-panel':calPanelWidth()+'px'}:null},h('div',{class:'calendar-main'},search.trim()?calSearchResults():calMode()==='month'?monthBoard():timeGrid()),docked||drawer?dayPanel(drawer):null,docked?calPanelResizer():null,drawer?h('div',{class:'drawer-scrim',onpointerdown:e=>{e.preventDefault();calDrawer=false;render();}}):null);}

// ---- Search (2026-10-21 user request): events whose title or place holds the words, upcoming first then past, by day; a row
// opens that day with the event's card. Every stored event, of any year (2026-10-28 owner 「1년 전부터 가져오기」, area J — it was
// a year back to two years ahead): this PC keeps all of its own, a connected calendar what its sync read (a year back to a year
// ahead, lib/providers/common.cjs dateRange). A series lists its occurrences a year back to two years ahead and its first one
// when that lies outside, so a series of any year is found while a daily one begun in 2015 adds one row, not every day since. ----
const calStartMs=e=>e.allDay?Date.parse(String(e.start).slice(0,10)+'T00:00:00'):Date.parse(e.start);
const calEndMs=e=>e.allDay?Date.parse((String(e.end||'').slice(0,10)||D.dayOffset(String(e.start).slice(0,10),1))+'T00:00:00'):Date.parse(e.end||e.start);
let calSearchCap={words:'',up:150,past:100};
// The hits without expanding every series on each keystroke (2026-10-27 review: walking three years of 100 series took 190 ms
// of a 400 ms keystroke). An occurrence carries its master's title and place, so the stored events are matched first and only
// the matching series are expanded; their expansions are kept while state.events (replaced wholesale on every change) and the
// window stay the same. Inside the window, the same hits in the same order as eventsBetween(from,to).filter(match).
let calSearchPool={events:null,from:'',series:new Map()};
function calSearchHits(words,today){
  const from=D.dayOffset(today,-365),to=D.dayOffset(today,730);
  if(calSearchPool.events!==state.events||calSearchPool.from!==from)calSearchPool={events:state.events,from,series:new Map()};
  const hidden=new Set(state.settings.hiddenCalendars||[]),out=[];
  for(const e of state.events){
    if(hidden.has(e.calendarId)||!findMatches((e.title||'')+'\n'+(e.location||''),words).length)continue;
    // A stored event at any date: the old window also dropped a connected one on its sync's first day once that was 366 days back
    // (a leap year, a day without a sync).
    if(!e.rrule){if(Number.isFinite(calStartMs(e)))out.push(e);continue;}
    let list=calSearchPool.series.get(e.id);
    if(!list)calSearchPool.series.set(e.id,list=calSeriesHits(e,from,to));
    out.push(...list);
  }
  // The years before the recent window (lib/calhistory.cjs): main finds them, a moment after the words settle; shown once it answered.
  const known=new Set(out.map(e=>e.id));
  for(const e of calHistoryHits(words))if(!known.has(e.id)&&!hidden.has(e.calendarId))out.push(e);
  return out;
}
let calHistoryFind={asked:'',words:'',events:[],timer:0};
function calHistoryHits(words){
  if(!state.calendarHistory?.at||!words)return [];
  const at=state.calendarHistory.at;
  if(calHistoryFind.asked!==words+'|'+at){
    calHistoryFind.asked=words+'|'+at;clearTimeout(calHistoryFind.timer);
    calHistoryFind.timer=setTimeout(()=>api.invoke('calendar:history-search',{text:words}).then(r=>{if(calHistoryFind.asked!==words+'|'+at)return;calHistoryFind.words=words+'|'+at;calHistoryFind.events=Array.isArray(r?.events)?r.events:[];if(search.trim()===words&&view==='calendar')renderMain();}).catch(()=>{}),180);
  }
  return calHistoryFind.words===words+'|'+at?calHistoryFind.events:[];
}
// A series' rows: its occurrences in the window, and its first one (D.firstOccurrence, excluded dates skipped) when that one is
// not already listed — told by its id, not by where the series begins (2026-10-30 Codex review R05: every five years from today
// with today's occurrence removed found nothing; its first one shown is in 2031).
function calSeriesHits(e,from,to){const list=D.expandEvent(e,from,to),head=D.firstOccurrence(e);return head&&!list.some(o=>o.id===head.id)?[head,...list]:list;}
function calSearchResults(){
  const words=search.trim();const today=D.dateKey();const now=Date.now();
  const hits=calSearchHits(words,today);
  // The nearest 150 upcoming and 100 past are listed and 「n개 더 보기」 shows more (a daily series matches hundreds, review).
  if(calSearchCap.words!==words)calSearchCap={words,up:150,past:100};
  const timed=hits.map(e=>({e,s:calStartMs(e),en:calEndMs(e)}));// parsed once per hit, not once per comparison (2026-10-27 review)
  const upAll=timed.filter(t=>t.en>=now).sort((a,b)=>a.s-b.s).map(t=>t.e),upcoming=upAll.slice(0,calSearchCap.up);
  const pastAll=timed.filter(t=>t.en<now).sort((a,b)=>b.s-a.s).map(t=>t.e),past=pastAll.slice(0,calSearchCap.past);
  const more=(rest,key)=>rest>0?btn(tr('{0}개 더 보기',[rest.toLocaleString(I.locale())]),()=>{const shown=calSearchCap[key];calSearchCap[key]+=key==='up'?150:100;renderMain();document.querySelectorAll('.calendar-search [data-part="'+key+'"] .search-hit')[shown]?.focus();},'button subtle search-more'):null;
  const dayLabel=key=>D.fromDate(key).toLocaleDateString(I.locale(),{...(key.slice(0,4)===today.slice(0,4)?{}:{year:'numeric'}),month:'long',day:'numeric',weekday:'long'});
  const row=e=>h('button',{type:'button',class:'search-hit'+(calPast(e)?' past':''),'data-event-key':e.id,onclick:()=>calOpenSearchHit(e),oncontextmenu:ev=>{ev.preventDefault();eventMenu(e,ev.clientX,ev.clientY);}},h('i',{class:'search-hit-bar',style:{background:eventColor(e)}}),h('span',{class:'search-hit-time'},timeLabel(e)),h('strong',{},markedText(e.title||tr('제목 없는 일정'),words)),e.location?h('span',{class:'search-hit-place'},markedText(e.location,words)):null);
  const group=list=>{const out=[];let day=null;for(const e of list){const key=D.localKey(e.start);if(key!==day){day=key;out.push(h('h4',{class:'search-day'},dayLabel(key)));}out.push(row(e));}return out;};
  return h('div',{class:'calendar-search'},h('div',{class:'search-head'},h('strong',{},tr('「{0}」 일정 {1}개',[words,hits.length])),btn(tr('검색 지우기'),()=>{search='';const box=document.querySelector('.search input');if(box){box.value='';box.blur();}render();},'button subtle')),
    upcoming.length?h('section',{'data-part':'up'},h('h3',{},tr('다가오는 일정')),group(upcoming),more(upAll.length-upcoming.length,'up')):null,past.length?h('section',{'data-part':'past'},h('h3',{},tr('지난 일정')),group(past),more(pastAll.length-past.length,'past')):null,
    hits.length?null:h('p',{class:'no-events'},tr('맞는 일정이 없어요. 제목과 장소에서 찾아요.')));
}
function calOpenSearchHit(e){const day=D.localKey(e.start);search='';const box=document.querySelector('.search input');if(box){box.value='';if(document.activeElement===box)box.blur();}selectedDate=day;calSyncMonth();render();const anchor=document.querySelector('#app .calendar-main [data-event-key="'+CSS.escape(e.id)+'"]');anchor?.scrollIntoView?.({block:'center'});openEventCard(e,anchor,anchor?null:undefined);}

// ---- Month view ----
// Rows of event chips that fit a cell (the 할 일 line counts as one), so tall windows show more and short ones never clip.
// Rows that fit under a cell's date header; a half row never shows — the rest folds into 「+N개」 (2026-10-26 review: the last
// row was cut in half at 1180 and 900). Measured: header 39px, a chip or count row 22px plus its 2px gap.
function calMonthLimit(){const grid=document.querySelector('.calendar-grid.large');const cellH=grid?(grid.clientHeight-30)/6:(innerHeight-52-16-24-34)/6;return Math.max(1,Math.floor((cellH-40)/24));}
const calFirstLabel=key=>D.fromDate(key).toLocaleDateString(I.locale(),{month:'short',day:'numeric'});
// The pool bucketed by day once per render instead of filtering the whole pool for each of the 42 cells (2026-10-27 review:
// D.inDay ran pool × 42 times, 62,831 calls per render with 100 series). An occurrence is tested only on the cells from its
// first day to its last; D.inDay still decides each boundary and every bucket is in eventsOn's order (pool order, then
// byEventOrder). `cells` are consecutive days; an unreadable date falls back to testing every cell. app.js monthGrid can share it.
function calDayBuckets(pool,cells){
  const first=D.fromDate(cells[0].key).getTime(),last=cells.length-1,day=/^\d{4}-\d\d-\d\d$/;
  const at=key=>day.test(key)?Math.round((D.fromDate(key).getTime()-first)/86400000):NaN;
  const lists=cells.map(()=>[]);
  for(const e of pool){
    let a,b;
    if(e.allDay){const s=String(e.start).slice(0,10);a=at(s);b=at(String(e.end||'').slice(0,10)||D.dayOffset(s,1))-1;}
    else{const s=new Date(e.start),en=new Date(e.end||e.start);a=at(D.dateKey(s));b=en>s?at(D.dateKey(new Date(en.getTime()-1))):a;}
    if(!Number.isFinite(a)||!Number.isFinite(b)){a=0;b=last;}
    for(let i=Math.max(0,a),stop=Math.min(last,b);i<=stop;i++)if(D.inDay(e,cells[i].key))lists[i].push(e);
  }
  return new Map(cells.map((c,i)=>[c.key,lists[i].sort(byEventOrder)]));
}
function monthBoard(){
  const cells=D.cellsFrom(calStart());const pool=eventsBetween(cells[0].key,D.dayOffset(cells[41].key,1));const byDay=calDayBuckets(pool,cells);const today=D.dateKey();const limit=calMonthLimit();
  // One Tab stop in the grid (2026-10-28 Codex review D09, C2: 42 day stops, then every chip and 「+n개」 of the month): the selected
  // day, and after it that day's own chips; the arrow keys (app.js keydown) still walk the days, and a chip still takes a click.
  const stop=gridTabStop(cells);
  const grid=h('div',{class:'calendar-grid large rolling'},I.weekdays('short').map((d,i)=>h('div',{class:'weekday'+(i===0?' sunday':'')+(i===6?' saturday':'')+(i===0||i===6?' weekend':'')},d)),cells.map((d,i)=>{
    const events=byDay.get(d.key);const tasks=state.tasks.filter(t=>t.dueDate===d.key&&!t.completed);
    const rows=Math.max(1,limit-(tasks.length?1:0));const shown=events.length>rows?events.slice(0,Math.max(1,rows-1)):events;const more=events.length-shown.length;const off=d.key===stop?null:-1;
    return h('div',{class:'calendar-day'+(d.outside?' outside':'')+(i%7===0||i%7===6?' weekend':'')+(d.key===today?' is-today':'')+(d.key===selectedDate?' is-selected':''),role:'button',tabindex:d.key===stop?0:-1,'aria-label':koreanDate(d.key)+(events.length?tr(" · 일정 {0}개", [events.length]):''),'data-focus-key':'day-'+d.key,'data-day':d.key,title:tr('두 번 누르면 일정 추가'),
      onclick:e=>{if(performance.now()<calSuppressClick||e.detail>=2)return;selectedDate=d.key;render();},ondblclick:e=>{if(performance.now()<calSuppressClick)return;selectedDate=d.key;addEvent(d.key,e.currentTarget);},
      onkeydown:e=>{if((e.key==='Enter'||e.key===' ')&&e.target===e.currentTarget){e.preventDefault();selectedDate=d.key;render();document.querySelector('[data-focus-key="day-'+d.key+'"]')?.focus({preventScroll:true});}}},
      h('button',{type:'button',class:'day-number'+(d.day===1?' first':''),tabindex:-1,title:tr('일간 보기'),onclick:e=>{e.stopPropagation();setCalMode('day',d.key);}},d.day===1?calFirstLabel(d.key):d.day),
      h('div',{class:'day-items'},shown.map(e=>{const chip=calChip(e,d.key);if(off)chip.tabIndex=off;return chip;}),more?h('button',{type:'button',class:'day-more',tabindex:off,onclick:ev=>{ev.stopPropagation();calDayList(d.key,ev.currentTarget);}},tr("+{0}개", [more])):null,tasks.length?h('button',{type:'button',class:'day-tasks',tabindex:off,onclick:ev=>{ev.stopPropagation();calOpenPanelFor(d.key);}},tr("할 일 {0}개", [tasks.length])):null));
  }));
  grid.addEventListener('wheel',calMonthWheel,{passive:false});
  return grid;
}
// A month chip: the shared chip plus dragging to another day.
function calChip(e,day){const chip=eventChip(e,day);chip.dataset.eventKey=e.id;chip.addEventListener('pointerdown',ev=>calPointerDown(ev,{kind:'month',event:e,day}));if(!canEditEvent(e))chip.classList.add('readonly');if(calPast(e))chip.classList.add('past');return chip;}
// "+N개": the day's events in a small list beside the cell; a row opens the event card.
function calDayList(day,anchor){const events=eventsOn(day);if(!closeCard(true))return;calCard={mode:'list',day,key:null,node:null,anchor};const node=h('div',{class:'event-card day-list',role:'dialog','aria-label':koreanDate(day),tabindex:-1},h('header',{class:'card-head'},h('strong',{},koreanDate(day)),ib('close',tr('닫기'),()=>closeCard(true))),h('div',{class:'agenda'},events.map(e=>h('button',{type:'button',class:'event-row','data-event-key':e.id,onclick:ev=>{const rect=calCard?.node?.getBoundingClientRect()||ev.currentTarget.getBoundingClientRect();closeCard(true);openEventCard(e,null,rect);}},h('span',{class:'event-line',style:{background:eventColor(e)}}),h('div',{},h('strong',{},e.title),h('span',{},timeLabel(e)))))));calCard.node=node;calCardRoot().replaceChildren(node);calPlaceCard(anchor.getBoundingClientRect());node.focus({preventScroll:true});}
// Wheel and trackpad: one week per 50px; within one gesture the rows stop when a month's 1st reaches the top (Notion).
let calWheelAcc=0,calWheelIdle=null,calWheelLast=0,calWheelHold=false;
function calMonthWheel(e){if(e.ctrlKey||Math.abs(e.deltaX)>Math.abs(e.deltaY))return;e.preventDefault();const dy=e.deltaMode===1?e.deltaY*40:e.deltaMode===2?e.deltaY*innerHeight:e.deltaY;clearTimeout(calWheelIdle);calWheelIdle=setTimeout(()=>{calWheelAcc=0;calWheelHold=false;},200);if(calWheelHold)return;calWheelAcc+=dy;if(Math.abs(calWheelAcc)<50)return;const now=performance.now();if(now-calWheelLast<60)return;calWheelLast=now;const dir=Math.sign(calWheelAcc);calWheelAcc-=dir*50;const top=calWeekStep(dir);if(D.cellsFrom(top).slice(0,7).some(c=>c.day===1)){calWheelHold=true;calWheelAcc=0;}}

// ---- Week and day views ----
const calPast=e=>e.allDay?String(e.end||'').slice(0,10)<=D.dateKey():new Date(e.end||e.start)<new Date();
// The current time in the gutter pill: the clock without 오전/오후 (the hour labels around it say which), so it fits.
const calClock=d=>timeFormat()==='24h'?fmtTime(d):(d.getHours()%12||12)+':'+String(d.getMinutes()).padStart(2,'0');
function calHourLabel(hour){const d=new Date(2000,0,1,hour);return fmtTime(d,true);}
function timeGrid(){
  const mode=calMode(),days=calDays(),today=D.dateKey();
  const pool=eventsBetween(days[0],D.dayOffset(days[days.length-1],1));
  const spans=pool.filter(D.spansDays),timed=pool.filter(e=>!D.spansDays(e));
  const minMinutes=Math.ceil(22/calHour*60);
  const head=h('div',{class:'time-head'},h('div',{class:'time-gutter-cell'}),days.map((key,i)=>{const d=D.fromDate(key);const dow=d.getDay();return h('button',{type:'button',class:'time-day'+(key===today?' is-today':'')+(key===selectedDate&&mode==='week'?' is-selected':'')+(dow===0||dow===6?' weekend':'')+(dow===0?' sunday':'')+(dow===6?' saturday':''),'data-day':key,'data-focus-key':'head-'+key,title:mode==='week'?tr('일간 보기'):koreanDate(key),onclick:()=>{if(mode==='week')setCalMode('day',key);}},h('span',{class:'time-weekday'},I.weekdays('short')[dow]),h('span',{class:'time-date'},d.getDate()));}));
  const tasksByDay=days.map(key=>state.tasks.filter(t=>t.dueDate===key&&!t.completed).length);
  return h('div',{class:'time-view '+mode,style:{'--days':days.length,'--hour':calHour+'px'}},h('div',{class:'time-scroll',onscroll:e=>{calScroll[mode]=e.currentTarget.scrollTop/calHour*60;}},h('div',{class:'time-sticky'},head,calAllDayRow(spans,days,tasksByDay)),calTimeBody(days,timed,minMinutes,today)));
}
function calAllDayRow(spans,days,tasksByDay){
  const {bars,lanes}=D.spanLayout(spans,days);const max=calAllDayOpen?lanes:Math.min(lanes,3);const shownBars=bars.filter(b=>b.lane<max);
  const hiddenPerDay=days.map((_,i)=>bars.filter(b=>b.lane>=max&&b.from<=i&&b.to>=i).length);
  const extraRow=hiddenPerDay.some(Boolean)?max+1:0,taskRow=Math.max(max,extraRow)+1;
  const toggle=lanes>3?ib(calAllDayOpen?'chevup':'chevdown',calAllDayOpen?tr('하루 종일 줄 접기'):tr('하루 종일 일정 모두 보기'),()=>{calAllDayOpen=!calAllDayOpen;render();},'allday-toggle'):null;
  const grid=h('div',{class:'allday-grid','data-allday':'1',ondblclick:e=>{if(performance.now()<calSuppressClick||e.target!==e.currentTarget)return;const day=calDayAtX(e.clientX);if(day)calCreateDraft({start:day,end:D.dayOffset(day,1),allDay:true});},onpointerdown:e=>{if(e.target===e.currentTarget)calPointerDown(e,{kind:'allday-create'});}},
    days.map((key,i)=>h('i',{class:'allday-cell'+([0,6].includes(D.fromDate(key).getDay())?' weekend':''),style:{gridColumn:String(i+1),gridRow:'1 / '+((tasksByDay.some(Boolean)?taskRow:Math.max(1,max,extraRow))+1)}})),
    shownBars.map(b=>calAllDayBar(b)),
    hiddenPerDay.map((n,i)=>n?h('button',{type:'button',class:'allday-more',style:{gridColumn:String(i+1),gridRow:String(extraRow)},onclick:()=>{calAllDayOpen=true;render();}},tr("+{0}개", [n])):null),
    tasksByDay.map((n,i)=>n?h('button',{type:'button',class:'allday-tasks',style:{gridColumn:String(i+1),gridRow:String(taskRow)},onclick:()=>calOpenPanelFor(days[i])},tr("할 일 {0}개", [n])):null),
    calDraft&&calDraft.allDay?calDraftBar(days):null);
  return h('div',{class:'time-allday'},h('div',{class:'time-gutter-cell allday-label'},toggle||h('span',{},tr('종일'))),grid);
}
function calAllDayBar(b){const e=b.event;const editable=canEditEvent(e);const color=eventColor(e);const first=!b.before;return h('div',{class:'allday-bar'+(b.before?' cont-before':'')+(b.after?' cont-after':'')+(editable?'':' readonly')+(calPast(e)?' past':''),style:{gridColumn:(b.from+1)+' / '+(b.to+2),gridRow:String(b.lane+1),'--cal-color':color},role:'button',tabindex:0,'data-event-key':e.id,title:e.title+(e.allDay?'':' · '+timeLabel(e)),onclick:ev=>{ev.stopPropagation();if(performance.now()<calSuppressClick)return;showEvent(e,ev.currentTarget);},onkeydown:ev=>calEventKey(ev,e),oncontextmenu:ev=>{ev.preventDefault();ev.stopPropagation();eventMenu(e,ev.clientX,ev.clientY);},onpointerdown:ev=>calPointerDown(ev,{kind:'allday',event:e})},!e.allDay&&first?h('span',{class:'chip-time'},fmtTime(e.start,true)+' ~'):null,h('span',{class:'chip-title'},e.title),isRecurring(e)?h('span',{class:'chip-repeat',title:tr('반복')},icon('repeat',12)):null);}
function calDraftBar(days){const s=calDraft.start,last=D.dayOffset(calDraft.end,-1);if(s>days[days.length-1]||last<days[0])return null;const from=days.indexOf(s<days[0]?days[0]:s),to=days.indexOf(last>days[days.length-1]?days[days.length-1]:last);if(to<0)return null;return h('div',{class:'allday-bar draft','data-event-key':'draft',style:{gridColumn:(from+1)+' / '+(to+2),gridRow:'1'}},h('span',{class:'chip-title'},calCard?.title||tr('새 일정')));}
function calTimeBody(days,timed,minMinutes,today){
  const gutter=h('div',{class:'time-gutter'},Array.from({length:23},(_,i)=>h('span',{class:'hour-label',style:{'--at':i+1}},calHourLabel(i+1))),days.includes(today)?h('span',{class:'now-pill'},calClock(new Date())):null);
  const cols=h('div',{class:'time-cols'},days.map(key=>{const dow=D.fromDate(key).getDay();const items=D.dayLayout(eventsOn(key,timed),key,minMinutes);return h('div',{class:'time-col'+(dow===0||dow===6?' weekend':'')+(key===today?' is-today':''),'data-day':key,onpointerdown:e=>{if(e.target===e.currentTarget)calPointerDown(e,{kind:'create',day:key});},onclick:e=>{if(e.target!==e.currentTarget||performance.now()<calSuppressClick||e.detail>=2)return;if(selectedDate!==key){selectedDate=key;calSyncMonth();render();}},ondblclick:e=>{if(e.target!==e.currentTarget||performance.now()<calSuppressClick)return;const start=D.atWall(key,Math.floor(calMinutesAt(e.clientY,e.currentTarget)/CAL_STEP)*CAL_STEP);calCreateDraft({start:start.toISOString(),end:new Date(start.getTime()+3600000).toISOString(),allDay:false});}},items.map(item=>calTimeBlock(item,key)),calDraft&&!calDraft.allDay?calDraftBlock(key,minMinutes):null,key===today?h('div',{class:'now-line'}):null);}),days.length>1&&days.includes(today)?h('div',{class:'now-dim'}):null);
  return h('div',{class:'time-body'},gutter,cols);
}
function calTimeBlock(item,day){
  const e=item.event;const editable=canEditEvent(e);const startsHere=D.localKey(e.start)===day,endsHere=D.dateKey(new Date(new Date(e.end||e.start).getTime()-1))===day||new Date(e.end||e.start).getTime()===new Date(e.start).getTime();
  const px=(item.bottom-item.top)/60*calHour;const lines=px<36?1:px<56?2:3;const time=startsHere?timeLabel(e):tr('{0}까지',[fmtTime(e.end)]);
  const node=h('div',{class:'time-event'+(editable?'':' readonly')+(calPast(e)?' past':'')+(lines===1?' one-line':''),role:'button',tabindex:0,'data-event-key':e.id,style:{'--top':item.top/60,'--len':(item.bottom-item.top)/60,'--col':item.col,'--span':item.span||1,'--cols':item.cols,'--cal-color':eventColor(e)},title:e.title+' · '+timeLabel(e),
    onclick:ev=>{ev.stopPropagation();if(performance.now()<calSuppressClick)return;showEvent(e,ev.currentTarget);},onkeydown:ev=>calEventKey(ev,e),oncontextmenu:ev=>{ev.preventDefault();ev.stopPropagation();eventMenu(e,ev.clientX,ev.clientY);},onpointerdown:ev=>calPointerDown(ev,{kind:'move',event:e,day})},
    h('span',{class:'time-event-title'},e.title||tr('제목 없는 일정'),startsHere?null:h('span',{class:'cont'},' '+tr('(계속)')),lines===1?h('span',{class:'time-event-inline'},' · '+fmtTime(startsHere?e.start:e.end)):null,isRecurring(e)?h('span',{class:'chip-repeat',title:tr('반복')},icon('repeat',12)):null),
    lines>1?h('span',{class:'time-event-time'},time):null,lines>2&&e.location?h('span',{class:'time-event-place'},e.location):null);
  if(editable&&startsHere&&px>=28)node.append(h('i',{class:'resize-handle top','aria-hidden':'true',onpointerdown:ev=>calPointerDown(ev,{kind:'resize-start',event:e,day})}));
  if(editable&&endsHere)node.append(h('i',{class:'resize-handle bottom','aria-hidden':'true',onpointerdown:ev=>calPointerDown(ev,{kind:'resize-end',event:e,day})}));
  return node;
}
function calDraftBlock(day,minMinutes){const s=new Date(calDraft.start),e=new Date(calDraft.end);const items=D.dayLayout([{id:'draft',start:calDraft.start,end:calDraft.end}].filter(x=>D.inDay(x,day)),day,minMinutes);if(!items.length)return null;const it=items[0];return h('div',{class:'time-event draft','data-event-key':'draft',style:{'--top':it.top/60,'--len':(it.bottom-it.top)/60,'--col':0,'--span':1,'--cols':1}},h('span',{class:'time-event-title'},calCard?.title||tr('새 일정')),h('span',{class:'time-event-time'},fmtTime(s)+'–'+fmtTime(e)));}
function calEventKey(ev,e){if(ev.key==='Enter'||ev.key===' '){ev.preventDefault();ev.stopPropagation();showEvent(e,ev.currentTarget);}else if((ev.key==='Delete'||ev.key==='Backspace')&&canEditEvent(e)){ev.preventDefault();ev.stopPropagation();deleteEventFlow(e);}}
const calMinutesAt=(y,col)=>Math.max(0,Math.min(1440,(y-col.getBoundingClientRect().top)/calHour*60));
function calDayAtX(x){const cells=[...document.querySelectorAll('.time-head .time-day')];if(!cells.length)return null;let best=cells[0];for(const c of cells){const r=c.getBoundingClientRect();if(x>=r.left)best=c;}return best.dataset.day;}
function calColumnAt(x){const cols=[...document.querySelectorAll('.time-col')];if(!cols.length)return null;let best=cols[0];for(const c of cols){if(x>=c.getBoundingClientRect().left)best=c;}return best;}

// ---- Pointer gestures: a click opens the card; a real drag (4px) moves, stretches or draws (Notion, Apple) ----
// While a time grid gesture runs, renders wait (calHolding) so the dragged block is not rebuilt under the pointer.
const calHolding=()=>calPanelDragging||Boolean(calGesture&&calGesture.started&&!calGesture.committing&&calGesture.kind!=='month');
let calKeyboardOpen=false;
function calPointerDown(ev,spec){
  if(ev.button!==0||isWidget||calGesture||ev.cardClosed||calCard?.closing||$('#modal-root .dialog'))return;
  closeMenu();
  ev.stopPropagation();
  if(ev.pointerType==='mouse')ev.preventDefault();
  calKeyboardOpen=false;
  calGesture={...spec,x0:ev.clientX,y0:ev.clientY,x:ev.clientX,y:ev.clientY,t0:performance.now(),pointerId:ev.pointerId,pointerType:ev.pointerType,started:false};
  window.addEventListener('pointermove',calPointerMove,true);window.addEventListener('pointerup',calPointerUp,true);window.addEventListener('pointercancel',calPointerCancel,true);
}
function calPointerMove(ev){const g=calGesture;if(!g||ev.pointerId!==g.pointerId)return;g.x=ev.clientX;g.y=ev.clientY;if(!g.started){if(Math.hypot(g.x-g.x0,g.y-g.y0)<4)return;if(g.pointerType==='touch'&&performance.now()-g.t0<500){calEndGesture();return;}calStartGesture();}ev.preventDefault();calUpdateGesture();}
function calPointerUp(ev){const g=calGesture;if(!g||ev.pointerId!==g.pointerId)return;if(!g.started){calEndGesture();return;}ev.preventDefault();calSuppressClick=performance.now()+350;g.x=ev.clientX;g.y=ev.clientY;calUpdateGesture();calFinishGesture();}
function calPointerCancel(ev){if(calGesture&&ev.pointerId===calGesture.pointerId)calCancelGesture();}
function calStartGesture(){
  const g=calGesture;g.started=true;if(!closeCard(true)){calEndGesture();return;}g.days=calDays();
  const e=g.event;g.denied=Boolean(e)&&!canEditEvent(e);
  document.body.classList.add('cal-dragging');if(g.denied)document.body.classList.add('cal-denied');if(g.kind==='resize-start'||g.kind==='resize-end')document.body.classList.add('cal-resizing');
  if(e&&!g.denied)for(const n of document.querySelectorAll('#app [data-event-key="'+CSS.escape(e.id)+'"]'))n.classList.add('drag-source');
  if(g.kind==='move'){const col=calColumnFor(g.day);const pointer=D.atWall(g.day,calMinutesAt(g.y0,col)).getTime();g.grab=pointer-new Date(e.start).getTime();g.length=Math.max(0,new Date(e.end||e.start)-new Date(e.start));}
  if(g.kind==='create'){const col=calColumnFor(g.day);g.anchor=D.atWall(g.day,Math.floor(calMinutesAt(g.y0,col)/CAL_STEP)*CAL_STEP);}
  if(g.kind==='allday'||g.kind==='allday-create')g.grabDay=calDayAtX(g.x0);
  if(g.kind==='month'&&!g.denied){const source=document.querySelector('#app .calendar-day [data-event-key="'+CSS.escape(e.id)+'"]');g.ghost=h('div',{class:'drag-chip'},source?source.cloneNode(true):e.title);document.body.append(g.ghost);g.edge=setInterval(calMonthEdge,400);}
  if(g.kind!=='month'&&g.kind!=='allday'&&g.kind!=='allday-create')g.frame=requestAnimationFrame(calAutoScroll);
}
function calUpdateGesture(){
  const g=calGesture;if(!g||!g.started)return;const e=g.event;
  if(g.kind==='month'){if(g.ghost){g.ghost.style.left=g.x+'px';g.ghost.style.top=g.y+'px';}const cell=document.elementFromPoint(g.x,g.y)?.closest?.('.calendar-day[data-day]');for(const n of document.querySelectorAll('.calendar-day.drop-target'))if(n!==cell)n.classList.remove('drop-target');if(g.denied)return;if(cell)cell.classList.add('drop-target');g.result=cell?calShiftTo(e,g.day,cell.dataset.day):null;return;}
  if(g.kind==='allday'||g.kind==='allday-create'){const day=calDayAtX(g.x);if(!day||g.denied)return;if(g.kind==='allday'){g.result=calShiftTo(e,g.grabDay,day);const r=g.result||{start:e.start,end:e.end};calAllDayGhost(e.allDay?r.start:D.localKey(r.start),e.allDay?D.dayOffset(r.end,-1):D.dateKey(new Date(new Date(r.end).getTime()-1)),e.title,eventColor(e));}else{const a=g.grabDay<day?g.grabDay:day,b=g.grabDay<day?day:g.grabDay;g.result={start:a,end:D.dayOffset(b,1),allDay:true};calAllDayGhost(a,b,tr('새 일정'),null);}return;}
  if(g.denied)return;
  const col=calColumnAt(g.x);if(!col)return;const days=g.days||calDays();const first=D.atWall(days[0],0).getTime(),last=D.atWall(days[days.length-1],1440-CAL_STEP).getTime();
  const pointerMinutes=calMinutesAt(g.y,col),pointerDay=col.dataset.day;
  if(g.kind==='move'){let start=new Date(D.atWall(pointerDay,pointerMinutes).getTime()-g.grab);const key=D.dateKey(start);start=D.atWall(key,D.snapMinutes(start.getHours()*60+start.getMinutes()+start.getSeconds()/60));start=new Date(Math.min(last,Math.max(Math.min(first,new Date(e.start).getTime()),start.getTime())));const end=new Date(start.getTime()+g.length);g.result={start:start.toISOString(),end:end.toISOString()};calGhost(start,end,calRangeLabel(start,end));return;}
  if(g.kind==='create'){const cur=D.atWall(pointerDay,Math.min(1440-CAL_STEP,Math.floor(pointerMinutes/CAL_STEP)*CAL_STEP));const start=cur<g.anchor?cur:g.anchor;const end=new Date((cur<g.anchor?g.anchor:cur).getTime()+CAL_STEP*60000);g.result={start:start.toISOString(),end:end.toISOString(),allDay:false};calGhost(start,end,calRangeLabel(start,end),true);return;}
  const m=pointerDay===g.day?pointerMinutes:pointerDay>g.day?1440:0;const snapped=D.atWall(g.day,D.snapMinutes(m));const s=new Date(e.start),en=new Date(e.end||e.start);
  if(g.kind==='resize-end'){const low=Math.max(s.getTime()+CAL_STEP*60000,D.atWall(g.day,0).getTime()),high=D.atWall(g.day,1440).getTime();const end=new Date(Math.min(high,Math.max(low,snapped.getTime())));g.result={start:e.start,end:end.toISOString()};calGhost(s,end,calRangeLabel(s,end,true));}
  else if(g.kind==='resize-start'){const low=D.atWall(g.day,0).getTime(),high=en.getTime()-CAL_STEP*60000;const start=new Date(Math.max(low,Math.min(high,snapped.getTime())));g.result={start:start.toISOString(),end:e.end};calGhost(start,en,calRangeLabel(start,en,true));}
}
function calFinishGesture(){
  const g=calGesture;const e=g.event,result=g.result;
  if(g.denied){toast(calReadOnlyReason(e),true);calEndGesture();return;}
  if(g.kind==='create'||g.kind==='allday-create'){calEndGesture();if(result)calCreateDraft(result);return;}
  const same=(a,b)=>a===b||(String(a).length>10&&Date.parse(a)===Date.parse(b));
  if(!result||(same(result.start,e.start)&&same(result.end,e.end))){calEndGesture();return;}
  const kind=g.kind.startsWith('resize')?'resize':'move';
  calStopGestureInput();g.committing=true;
  calCommitChange(e,result,kind).finally(()=>{if(calGesture===g)calEndGesture();});
}
function calCancelGesture(){calEndGesture();}
function calStopGestureInput(){window.removeEventListener('pointermove',calPointerMove,true);window.removeEventListener('pointerup',calPointerUp,true);window.removeEventListener('pointercancel',calPointerCancel,true);const g=calGesture;if(g){cancelAnimationFrame(g.frame);clearInterval(g.edge);g.ghost?.remove();}document.body.classList.remove('cal-dragging','cal-denied','cal-resizing');for(const n of document.querySelectorAll('.drop-target'))n.classList.remove('drop-target');}
function calEndGesture(){calStopGestureInput();calGesture=null;for(const n of document.querySelectorAll('.time-event.ghost,.allday-bar.ghost'))n.remove();for(const n of document.querySelectorAll('.drag-source'))n.classList.remove('drag-source');if(renderPending){renderPending=false;render();}}
// Ghost blocks for the dragged or drawn range, one per visible day it touches.
function calGhost(start,end,label,draft){for(const n of document.querySelectorAll('.time-event.ghost'))n.remove();const e=calGesture?.event;for(const col of document.querySelectorAll('.time-col')){const day=col.dataset.day;const piece={id:'ghost',start:start.toISOString(),end:end.toISOString()};if(!D.inDay(piece,day))continue;const it=D.dayLayout([piece],day,Math.ceil(22/calHour*60))[0];if(!it)continue;col.append(h('div',{class:'time-event ghost'+(draft?' draft':''),style:{'--top':it.top/60,'--len':(it.bottom-it.top)/60,'--col':0,'--span':1,'--cols':1,'--cal-color':e?eventColor(e):null}},h('span',{class:'time-event-title'},e?e.title:tr('새 일정')),h('span',{class:'time-event-time'},label)));}}
function calAllDayGhost(from,to,title,color){for(const n of document.querySelectorAll('.allday-bar.ghost'))n.remove();const grid=document.querySelector('.allday-grid');if(!grid)return;const days=calGesture?.days||calDays();const a=from<days[0]?days[0]:from,b=to>days[days.length-1]?days[days.length-1]:to;const i=days.indexOf(a),j=days.indexOf(b);if(i<0||j<0||j<i)return;grid.append(h('div',{class:'allday-bar ghost'+(color?'':' draft'),style:{gridColumn:(i+1)+' / '+(j+2),gridRow:'1','--cal-color':color}},h('span',{class:'chip-title'},title)));}
function calRangeLabel(start,end,withLength){const text=fmtTime(start)+' – '+fmtTime(end);return withLength?text+' ('+calDuration(Math.round((end-start)/60000))+')':text;}
function calDuration(minutes){const hrs=Math.floor(minutes/60),mins=minutes%60;return [hrs?tr('{0}시간',[hrs]):'',mins?tr('{0}분',[mins]):''].filter(Boolean).join(' ')||tr('{0}분',[0]);}
const calColumnFor=day=>document.querySelector('.time-col[data-day="'+day+'"]')||calColumnAt(0);
// Same clock time (timed) or the same number of days (all-day) on the day the event was dropped on.
function calShiftTo(e,fromDay,toDay){if(!fromDay||!toDay||fromDay===toDay)return null;const days=Math.round((D.fromDate(toDay)-D.fromDate(fromDay))/86400000);return days?D.shiftedDays(e,days):null;}
// Time grid: scroll while the pointer rests near the top or bottom edge.
function calAutoScroll(){const g=calGesture;if(!g||!g.started)return;const scroller=document.querySelector('.time-scroll');if(scroller){const r=scroller.getBoundingClientRect();const top=r.top+(document.querySelector('.time-sticky')?.offsetHeight||0);let dy=0;if(g.y<top+40)dy=-Math.ceil((40-(g.y-top))/40*14);else if(g.y>r.bottom-40)dy=Math.ceil((40-(r.bottom-g.y))/40*14);if(dy){const before=scroller.scrollTop;scroller.scrollTop+=dy;if(scroller.scrollTop!==before)calUpdateGesture();}}g.frame=requestAnimationFrame(calAutoScroll);}
// Month view: resting near the top or bottom edge moves the rows a week (renders are allowed during a month drag).
function calMonthEdge(){const g=calGesture;const cells=document.querySelectorAll('.calendar-grid.large .calendar-day');if(!g||!cells.length)return;const top=cells[0].getBoundingClientRect().top,bottom=cells[cells.length-1].getBoundingClientRect().bottom;const dir=g.y<top+12?-1:g.y>bottom-12?1:0;if(!dir){g.edgeSince=0;return;}const now=performance.now();if(!g.edgeSince){g.edgeSince=now;return;}if(now-g.edgeSince<500)return;g.edgeSince=now;calWeekStep(dir);calUpdateGesture();}
function calReadOnlyReason(e){if(e?.history)return tr('1년보다 오래된 일정은 여기서 볼 수만 있어요. 고치려면 원래 달력 앱에서 바꿔 주세요.');const cal=calendarOf(e);const account=state.accounts.find(a=>a.id===cal?.accountId);return account&&account.calendarWrite===false?tr('계정 연결 화면에서 「다시 로그인해 달력 쓰기 허용」을 누르면 여기서도 고칠 수 있어요.'):tr('읽기 전용으로 공유된 달력이라 원래 달력 앱에서만 바꿀 수 있어요.');}

// ---- Saving a moved or stretched event: repeating events ask how far it applies; Undo in the toast and Ctrl+Z ----
function calAskScope(title,labels){return new Promise(resolve=>{let done=false;const finish=v=>{if(done)return;done=true;resolve(v);};modal(title,h('div',{class:'dialog-body'},h('div',{class:'scope-options'},[['one',labels.one],['future',labels.future],['all',labels.all]].filter(([,l])=>l).map(([s,l])=>btn(l,()=>{finish(s);closeModal();},'button subtle wide'+(s==='one'?' primary-choice':'')))),h('div',{class:'dialog-footer'},btn(tr('취소'),()=>{finish(null);closeModal();},'button subtle'))),false,{stack:true,onDismiss:()=>finish(null)});});}
const calSeries=e=>Boolean(e&&((e.rrule&&e.masterId)||(!isLocalEvent(e)&&e.recurring)));
function calScopeLabels(e,change){const provider=!isLocalEvent(e);const dayChanged=('start' in change)&&D.localKey(change.start)!==D.localKey(e.start);const flip=('allDay' in change)&&Boolean(change.allDay)!==Boolean(e.allDay);const ruleChanged='rrule' in change;const c=D.scopeChoices(e,{provider,dayChanged,flip,ruleChanged});return {one:c.one?tr('이 일정만'):null,future:c.future?tr('이후 모든 일정'):null,all:c.all?tr('모든 일정'):null};}
async function calCommitChange(e,change,kind){
  const before={start:e.start,end:e.end};let scope=null;
  if(calSeries(e)){scope=await calAskScope(tr('「{0}」 반복 일정을 어떻게 바꿀까요?',[shortTitle(e.title)||tr('제목 없는 일정')]),calScopeLabels(e,change));if(!scope)return;}
  let result;try{result=await run('event:update',{id:e.id,...(scope?{scope}:{}),...change});}catch{return;}
  const occurrence=Boolean(e.rrule&&e.masterId);
  const undoId=scope==='all'&&occurrence?e.masterId+'@'+(e.allDay?change.start:new Date(change.start).toISOString()):(result?.id||e.id);
  const canUndo=!scope||scope==='one'||(scope==='all'&&occurrence);
  const text=kind==='resize'?tr('일정 시간을 바꿨어요.'):tr('일정을 옮겼어요.');
  if(!canUndo){toast(text);return;}
  // Redo moves it again: the plain event or the occurrence's own exception by id, a whole series from the occurrence as it was.
  // Undo and redo act only on the event as the last step left it; a change made elsewhere meanwhile wins (staleUndo).
  const same=(a,b)=>a===b||(Boolean(a)&&Boolean(b)&&Date.parse(a)===Date.parse(b));
  // A whole series ('all') is compared as stored — its master and exceptions as the last step left them (Codex review: the
  // occurrence id is computed, so the lookup always missed and a change made in a widget meanwhile was overwritten).
  const seriesState=()=>JSON.stringify(state.events.filter(x=>x.id===e.masterId||x.masterId===e.masterId).sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0));
  let expected=scope==='all'&&occurrence?seriesState():null;
  const remember=()=>{if(expected!==null)expected=seriesState();};
  const at=times=>{if(expected!==null)return seriesState()===expected;const cur=state.events.find(x=>x.id===undoId);return Boolean(cur)&&['start','end'].filter(k=>k in times).every(k=>same(cur[k],times[k]));};
  const again=()=>(at(before)?run('event:update',scope==='all'?{id:e.id,scope:'all',...change}:{id:undoId,...change}):Promise.reject(staleUndo())).then(()=>{remember();undoToast(text,tr('되돌리기'),undo,again);});
  const undo=()=>at(change)?run('event:update',{id:undoId,...(scope&&scope!=='one'?{scope}:{}),...before}).then(remember):Promise.reject(staleUndo());
  undoToast(text,tr('되돌리기'),undo,again);
}

// ---- New events: a draft on the grid (or a day cell) with the card in create mode ----
function calNewEvent(day,anchor){
  if(!writableCalendars().length)return false;
  // A repeating event's card waiting on its scope question keeps the screen (Codex review 2026-10-26: Ctrl+N opened a new card
  // over it, and cancelling the question lost the edit). true: handled, the caller opens nothing else.
  if(!closeCard(true))return true;
  const [s,e]=D.defaultEventTimes(day);const draft={start:new Date(s).toISOString(),end:new Date(e).toISOString(),allDay:false};
  if(view==='calendar'&&calMode()!=='month'){if(!calDays().includes(day)){selectedDate=day;calSyncMonth();}calCreateDraft(draft);return true;}
  let target=anchor||(view==='calendar'?document.querySelector('#app .calendar-day[data-day="'+day+'"]'):null);
  if(!target&&view==='calendar'){selectedDate=day;calSyncMonth();render();target=document.querySelector('#app .calendar-day[data-day="'+day+'"]');}
  if(!target)return false;
  if(!closeCard(true))return true;calOpenCard({mode:'create',draft},target.getBoundingClientRect());return true;
}
function calCreateDraft(draft){if(!closeCard(true))return;calDraft={...draft};render();const anchor=document.querySelector('#app [data-event-key="draft"]');anchor?.scrollIntoView?.({block:'nearest'});calOpenCard({mode:'create',draft},anchor?anchor.getBoundingClientRect():null);}

// ---- The event card (Notion's floating event panel): opens beside the event, saves as you go ----
function calCardRoot(){let root=document.getElementById('card-root');if(!root){root=h('div',{id:'card-root'});document.body.append(root);}return root;}
function calValuesOf(src){const allDay=Boolean(src.allDay);const startKey=String(src.start).slice(0,10);return {title:src.title||'',allDay,start:allDay?startKey:toLocalInput(src.start),end:allDay?D.dayOffset(String(src.end||D.dayOffset(startKey,1)).slice(0,10),-1):toLocalInput(src.end||src.start),location:src.location||'',color:src.color||null,rrule:src.rrule||'',alert:src.alert===undefined?undefined:src.alert};}
const calTimes=v=>({start:v.allDay?v.start:new Date(v.start).toISOString(),end:v.allDay?D.dayOffset(v.end,1):new Date(v.end).toISOString(),allDay:v.allDay});
// Clicking an event (any view, the right panel, the tasks screen) opens its card; a read-only event shows the same card as text.
function openEventCard(e,anchor,rect){if(isWidget)return false;closeMenu();if(calCard&&calCard.key===e.id&&calCard.node){calCard.node.focus({preventScroll:true});return true;}if(!closeCard(true))return true;const region=anchor?.closest?.(calAnchorRegions);calOpenCard({mode:canEditEvent(e)?'edit':'view',event:e},rect||(anchor?anchor.getBoundingClientRect():null));if(calCard&&region)calCard.region='.'+region.classList[0];return true;}
function calOpenCard({mode,event,draft},rect){
  const v=calValuesOf(mode==='create'?{...draft,title:''}:event);
  const calendars=writableCalendars();const preferred=D.defaultCalendarId(state);
  calCard={mode,event:event||null,key:mode==='create'?'draft':event.id,v,original:{...v},pending:{},timer:null,series:mode==='edit'&&calSeries(event),calendarId:mode==='create'?(calendars.find(c=>c.id===preferred)||calendars[0])?.id:event.calendarId,swatches:false,title:'',rect,node:null};
  calRenderCard();calPlaceCard(rect);
  const title=calCard.node.querySelector('.card-title');
  if(mode==='create'||calKeyboardOpen)title?.focus({preventScroll:true});else calCard.node.focus({preventScroll:true});
  calMarkAnchor();
}
function calRenderCard(){
  const c=calCard;if(!c)return;const active=document.activeElement;const focusKey=c.node&&c.node.contains(active)?active.closest('[data-card-focus]')?.getAttribute('data-card-focus')||null:null;/* a choice made in the open menu: its option has focus (area H) */
  const node=calCardNode();if(c.node&&c.node.isConnected)c.node.replaceWith(node);else calCardRoot().replaceChildren(node);
  if(c.node){node.style.left=c.node.style.left;node.style.top=c.node.style.top;}c.node=node;
  if(focusKey)node.querySelector('[data-card-focus="'+focusKey+'"]')?.focus({preventScroll:true});
  const title=node.querySelector('textarea.card-title');if(title)calGrow(title);
}
// Enter in a card field: with the Korean IME the Enter that ends a syllable arrives while composing (and Windows sends no second
// Enter), so it acts right after the composition ends — one Enter saves, as it does for English text.
function calEnter(action){let pending=false;return {onkeydown:ev=>{if(ev.key!=='Enter'||ev.shiftKey)return;if(ev.isComposing||ev.keyCode===229){pending=true;return;}ev.preventDefault();pending=false;action(ev.target);},oncompositionend:ev=>{if(!pending)return;const target=ev.target;setTimeout(()=>{if(!pending)return;pending=false;action(target);},30);}};}
const calGrow=t=>{t.style.height='auto';t.style.height=Math.min(t.scrollHeight,3*24+8)+'px';};
function calCardNode(){
  const c=calCard,v=c.v,e=c.event,view=c.mode==='view';
  const cal=c.mode==='create'?state.calendars.find(x=>x.id===c.calendarId):calendarOf(e);const base=calendarColor(cal);const color=v.color||base;
  // An event older than the recent window keeps its colour as it is (lib/calhistory.cjs): a dot, not a button.
  const head=h('header',{class:'card-head'},e?.history?h('span',{class:'card-color static',style:{'--dot':color},'aria-hidden':'true'}):h('button',{type:'button',class:'card-color',style:{'--dot':color},'aria-label':tr('이 일정의 색'),title:tr('이 일정의 색'),'aria-expanded':c.swatches,'data-card-focus':'color',onclick:()=>{c.swatches=!c.swatches;calRenderCard();}}),h('span',{class:'card-spacer'}),c.mode==='create'?null:ib('more',tr('더 보기'),ev=>calCardMenu(ev.currentTarget)),ib('close',c.mode==='create'?tr('취소'):tr('닫기'),()=>closeCard(c.mode!=='create')));
  const title=view?h('h2',{class:'card-title static'},e.title||tr('제목 없는 일정')):h('textarea',{class:'card-title',rows:1,maxlength:500,placeholder:c.mode==='create'?tr('새 일정'):tr('일정 제목'),'aria-label':tr('일정 제목'),'data-card-focus':'title',value:v.title,
    oninput:ev=>{const t=ev.target;if(t.value.includes('\n'))t.value=t.value.replace(/\n+/g,' ');v.title=t.value;c.title=t.value.trim();calGrow(t);for(const n of document.querySelectorAll('#app [data-event-key="draft"] .time-event-title,#app [data-event-key="draft"] .chip-title'))n.textContent=c.title||tr('새 일정');},
    ...calEnter(target=>{if(c.mode==='create')calSaveNew(true);else target.blur();}),
    onblur:()=>{if(c.mode!=='edit')return;const text=v.title.trim();if(!text){v.title=c.original.title;calRenderCard();return;}if(text!==c.original.title){c.original.title=text;calCardChange({title:text});}}});
  const rows=[head,title,calWhenRow(view)];
  if(!view)rows.push(h('div',{class:'card-row card-chips'},h('label',{class:'card-chip'+(v.allDay?' on':'')},h('input',{type:'checkbox',checked:v.allDay,'data-card-focus':'allday',onchange:ev=>calSetAllDay(ev.target.checked)}),tr('하루 종일')),calRepeatControl()));
  else if(isRecurring(e))rows.push(h('div',{class:'card-row'},icon('repeat',16),h('span',{},tr('반복 일정'))));
  if(!view)rows.push(h('div',{class:'card-row'},icon('mappin',16),h('input',{class:'card-input',type:'text',maxlength:1000,placeholder:tr('장소 추가'),'aria-label':tr('장소'),'data-card-focus':'location',value:v.location,oninput:ev=>{v.location=ev.target.value;},...calEnter(target=>{if(c.mode==='create')calSaveNew(true);else target.blur();}),onblur:()=>{if(c.mode==='edit'&&v.location!==c.original.location){c.original.location=v.location;calCardChange({location:v.location});}}})));
  else if(e.location)rows.push(h('div',{class:'card-row'},icon('mappin',16),h('span',{},e.location)));
  rows.push(calAlertRow(view));
  const calendars=writableCalendars();
  rows.push(h('div',{class:'card-row'},icon('calendar',16),c.mode==='create'&&calendars.length>1?h('select',{class:'card-select','aria-label':tr('달력'),'data-card-focus':'calendar',onchange:ev=>{c.calendarId=ev.target.value;/* 「당일 오전 9시」 cannot go to Google or Outlook: that calendar's default instead */if(typeof v.alert==='number'&&v.alert<0&&!calOnDayAlerts())v.alert=undefined;calRenderCard();}},calendars.map(x=>h('option',{value:x.id,selected:x.id===c.calendarId?'':null},calendarLabel(x)))):h('span',{class:'card-cal',style:{'--dot':base}},h('i',{}),calendarLabel(cal)||tr('달력'))));
  if(c.swatches)rows.push(h('div',{class:'card-swatches'},eventSwatchPicker(v.color,base,col=>{v.color=col;if(view)colorEventFlow(e,col);else if(c.mode==='edit'&&c.series)calSeriesColor(c,col);else if(c.mode==='edit')calCardChange({color:col});calRenderCard();}).node));
  if(view)rows.push(h('p',{class:'card-note'},tr('{0} · 읽기 전용',[calendarLabel(cal)||tr('달력')])),h('p',{class:'card-note'},calReadOnlyReason(e)));
  if(c.mode==='create')rows.push(h('footer',{class:'card-footer'},btn(tr('취소'),()=>closeCard(false),'button subtle'),btn(tr('저장'),()=>calSaveNew(true),'button primary')));
  return h('div',{class:'event-card'+(view?' readonly':''),role:'dialog','aria-label':v.title||e?.title||tr('새 일정'),tabindex:-1,onkeydown:ev=>{if((ev.key==='Delete'||ev.key==='Backspace')&&c.mode==='edit'&&!calFieldFocused()){ev.preventDefault();calCardDelete();}}},rows);
}
// A repeating event's colour from its card: 「이 일정만」 makes the occurrence an exception, so the card's waiting changes go
// in the same request and the card moves to that exception (2026-10-21 review: they were dropped with the card).
function calSeriesColor(c,col){
  // A repeat change waiting in the card cannot go to one occurrence (main keeps a rule only for the series): the colour
  // then waits with it for the scope question on close (2026-10-21 review round 6: 「이 일정만」 dropped the repeat change).
  if('rrule' in c.pending){c.pending.color=col;return;}
  colorEventFlow(c.event,col,{pending:c.pending,start:()=>{c.hold=true;},done:r=>{c.hold=false;if(calCard!==c)return;if(r&&r.id){c.pending={};c.event=r;c.key=r.id;c.series=calSeries(r);c.v=calValuesOf(r);c.original={...c.v};calRenderCard();calMarkAnchor();}else calCardAfterRender();}});}
const calDateLabel=key=>D.fromDate(key).toLocaleDateString(I.locale(),{month:'long',day:'numeric',weekday:'short'});
function calDateButton(which){const v=calCard.v;const key=(which==='start'?v.start:v.end).slice(0,10);const picker=h('input',{type:'date',value:key,tabindex:-1,'aria-hidden':'true',onchange:ev=>{if(ev.target.value)calSetDate(which,ev.target.value);}});return h('span',{class:'card-date-wrap'},h('button',{type:'button',class:'card-date','data-card-focus':'date-'+which,'aria-label':(which==='start'?tr('시작 날짜'):tr('종료 날짜'))+' '+calDateLabel(key),onclick:()=>{try{picker.showPicker();}catch{picker.focus();}}},calDateLabel(key)),picker);}
function calTimeInput(which){const v=calCard.v;const value=which==='start'?v.start:v.end;return h('input',{class:'card-time',type:'text',value:fmtTime(new Date(value)),'aria-label':which==='start'?tr('시작 시간'):tr('종료 시간'),'data-card-focus':'time-'+which,autocomplete:'off',spellcheck:'false',onfocus:ev=>ev.target.select(),onclick:ev=>calTimeMenu(which,ev.currentTarget),onkeydown:ev=>{if(ev.isComposing)return;if(calTimeListKey(which,ev.currentTarget,ev))return;if(ev.key==='Enter'){ev.preventDefault();closeMenu();calTypedTime(which,ev.currentTarget);}else if(ev.key==='ArrowDown'){ev.preventDefault();calTimeMenu(which,ev.currentTarget);}},onblur:ev=>calTypedTime(which,ev.currentTarget,true)});}
function calWhenRow(view){const c=calCard,v=c.v,e=c.event;if(view)return h('div',{class:'card-row card-when'},icon('clock',16),h('span',{},calDateLabel(D.localKey(e.start))+' · '+timeLabel(e)));const parts=[calDateButton('start')];if(v.allDay){parts.push(h('span',{class:'card-dash'},'–'),calDateButton('end'));}else{parts.push(calTimeInput('start'),h('span',{class:'card-dash'},'–'),calTimeInput('end'));if(v.end.slice(0,10)!==v.start.slice(0,10))parts.push(calDateButton('end'));}return h('div',{class:'card-row card-when'},icon('clock',16),parts);}
// Typed times: 3, 15, 1530, 15:30, 3시, 3시 30분, 오후 3시, 3:30pm. With the 12-hour clock a bare 1–7 means the afternoon (Notion).
function calParseClock(text){let t=String(text||'').trim().toLowerCase().replace(/\s+/g,'');if(!t)return null;let pm=null;if(/^(오후|pm)|(오후|pm|p)$/.test(t))pm=true;else if(/^(오전|am)|(오전|am|a)$/.test(t))pm=false;t=t.replace(/오전|오후|am|pm/g,'').replace(/[ap]$/,'');let hrs,mins=0,x,bare=false;if((x=t.match(/^(\d{1,2})시(?:(\d{1,2})분?)?$/))){hrs=+x[1];mins=+(x[2]||0);bare=!x[2];}else if((x=t.match(/^(\d{1,2})[:.](\d{2})$/))){hrs=+x[1];mins=+x[2];}else if((x=t.match(/^(\d{3,4})$/))){hrs=Math.floor(+x[1]/100);mins=+x[1]%100;}else if((x=t.match(/^(\d{1,2})$/))){hrs=+x[1];bare=true;}else return null;if(mins>59||hrs>24)return null;if(pm===true&&hrs<12)hrs+=12;else if(pm===false&&hrs===12)hrs=0;else if(pm===null&&bare&&!/^0/.test(t)&&timeFormat()==='12h'&&hrs>=1&&hrs<=7)hrs+=12;if(hrs===24)hrs=0;return hrs*60+mins;}
const calLocalAt=(key,minutes)=>key+'T'+String(Math.floor(minutes/60)).padStart(2,'0')+':'+String(minutes%60).padStart(2,'0');
function calTypedTime(which,input,quiet){if(quiet&&calCard)calCard.soft=true;try{calTypedTimeNow(which,input,quiet);}finally{if(calCard)calCard.soft=false;}}
function calTypedTimeNow(which,input,quiet){const c=calCard;if(!c)return;const v=c.v;const current=which==='start'?v.start:v.end;const minutes=calParseClock(input.value);if(minutes===null){if(!quiet&&input.value.trim())toast(tr('시간을 알아볼 수 없어요. 예: 15:30, 오후 3시'),true);input.value=fmtTime(new Date(current));return;}const d=new Date(current);if(d.getHours()*60+d.getMinutes()===minutes){input.value=fmtTime(d);return;}calSetTime(which,minutes);}
function calSetTime(which,minutes,endDay){if(!calCard)return;const v=calCard.v;if(which==='start'){const next=calLocalAt(v.start.slice(0,10),minutes);v.end=D.followStart(v.start,next,v.end,false)||v.end;v.start=next;}else{let key=endDay||v.end.slice(0,10);let next=calLocalAt(key,minutes);if(!endDay&&next<=v.start){key=D.dayOffset(v.start.slice(0,10),next.slice(11)<=v.start.slice(11)?1:0);next=calLocalAt(key,minutes);}v.end=next;}calWhenChanged();}
function calTimeMenu(which,input){const c=calCard;if(!c)return;const v=c.v;const r=input.getBoundingClientRect();const start=new Date(v.start);let items,current;if(which==='start'){const day=v.start.slice(0,10);current=Math.round((start.getHours()*60+start.getMinutes())/CAL_STEP);items=Array.from({length:96},(_,i)=>({label:fmtTime(D.atWall(day,i*CAL_STEP)),onClick:()=>{if(calCard===c)calSetTime('start',i*CAL_STEP);}}));}else{const length=Math.round((new Date(v.end)-start)/60000);current=Math.max(0,Math.round(length/CAL_STEP)-1);items=Array.from({length:96},(_,i)=>{const t=new Date(start.getTime()+(i+1)*CAL_STEP*60000);return {label:fmtTime(t),hint:calDuration((i+1)*CAL_STEP),onClick:()=>{if(calCard===c)calSetTime('end',t.getHours()*60+t.getMinutes(),D.dateKey(t));}};});}contextMenu(r.left,r.bottom+4,{items});const nodes=[...(menuRoot?.querySelectorAll('.menu-item')||[])];c.timeList={which,nodes,index:Math.min(current,95),moved:false};const node=nodes[c.timeList.index];if(node){menuRoot.classList.add('time-menu','card-menu');node.classList.add('current');node.scrollIntoView({block:'center'});}input.focus({preventScroll:true});}
// ↑/↓ in a time field move through its open list, Enter picks the marked row (or the typed time when the list was not used).
function calTimeListKey(which,input,ev){const c=calCard;const list=c?.timeList;if(!list||list.which!==which||!menuRoot||!list.nodes[0]?.isConnected)return false;if(ev.key==='ArrowDown'||ev.key==='ArrowUp'){ev.preventDefault();list.nodes[list.index]?.classList.remove('current');list.index=Math.max(0,Math.min(list.nodes.length-1,list.index+(ev.key==='ArrowDown'?1:-1)));const node=list.nodes[list.index];node.classList.add('current');node.scrollIntoView({block:'nearest'});list.moved=true;return true;}if(ev.key==='Enter'&&list.moved){ev.preventDefault();list.nodes[list.index]?.click();c.timeList=null;return true;}return false;}
function calSetDate(which,key){const v=calCard.v;const was=v.start;if(which==='start'){if(v.allDay){v.end=D.followStart(v.start,key,v.end,true)||key;v.start=key;}else{const next=key+v.start.slice(10);v.end=D.followStart(v.start,next,v.end,false)||v.end;v.start=next;}}else if(v.allDay){if(key<v.start){toast(tr('종료 날짜를 시작 날짜와 같거나 뒤로 설정하세요.'),true);calRenderCard();return;}v.end=key;}else{const next=key+v.end.slice(10);if(next<=v.start){toast(tr('종료 시간을 시작 시간 뒤로 설정하세요.'),true);calRenderCard();return;}v.end=next;}calFollowRule(was);calWhenChanged();}
// The repeat moves its weekdays with the start date: a new card's, a repeat chosen and not sent yet, and a card that holds
// the series itself (main moves that one's stored rule too) — 2026-10-21 review: the rule stayed on the old weekday.
function calFollowRule(was){const c=calCard;if(!c||!c.v.rrule)return;const waiting=c.mode==='edit'&&('rrule' in c.pending);const master=c.mode==='edit'&&Boolean(c.event?.rrule&&!c.event.masterId);if(c.mode!=='create'&&!waiting&&!master)return;const next=D.shiftRule(c.v.rrule,was,c.v.start);if(next&&next!==c.v.rrule){c.v.rrule=next;if(waiting)c.pending.rrule=next;}}
function calSetAllDay(on){const c=calCard,v=c.v;if(on===v.allDay)return;if(on){const startKey=v.start.slice(0,10);let endKey=v.end.slice(0,10);if(v.end.slice(11)==='00:00'&&endKey>startKey)endKey=D.dayOffset(endKey,-1);v.start=startKey;v.end=endKey<startKey?startKey:endKey;}else{const day=v.start.slice(0,10);const last=String(v.end||day).slice(0,10);const lastDay=last>day?last:day;/* v.end is the last day itself while all-day (calValuesOf); a several-day event keeps its days (Codex review 2026-10-26) */const times=c.mode==='create'&&lastDay===day?D.defaultEventTimes(day):[day+'T09:00',lastDay+'T10:00'];v.start=times[0];v.end=times[1];}/* the card remembers the alert each kind had, so 하루 종일 on and off gives 「1시간 전」 back (2026-10-27 review) */const kept=c.alerts||(c.alerts={});kept[v.allDay?'allDay':'timed']=v.alert;v.allDay=on;if(typeof v.alert==='number'){const back=kept[on?'allDay':'timed'];const fits=typeof back==='number'&&(on?(back>=0||calOnDayAlerts()):back>=0);v.alert=fits?back:on?(calOnDayAlerts()?-540:900):10;if(c.mode==='edit')calCardChange({alert:v.alert});}calWhenChanged();}
function calWhenChanged(){const c=calCard;if(!c)return;if(c.soft){if(c.mode==='create')calDraft=calTimes(c.v);else calCardChange(calTimes(c.v));calSyncWhen(c);return;}if(c.mode==='create'){calDraft=calTimes(c.v);calRenderCard();render();return;}calCardChange(calTimes(c.v));calRenderCard();}
// The time fields and date labels shown again from the values, without rebuilding the card.
function calSyncWhen(c){const v=c.v;if(v.allDay||!c.node)return;for(const which of ['start','end']){const input=c.node.querySelector('[data-card-focus="time-'+which+'"]');if(input&&document.activeElement!==input)input.value=fmtTime(new Date(which==='start'?v.start:v.end));}}
// Repeat presets worked out from the event's own date (Notion, Google), the current rule when it is none of them, and 사용자 지정….
function calRepeatOptions(day,current){const d=D.fromDate(day);const wd=I.weekdays('long')[d.getDay()];const o=ordinalOf(d);const weekly=n=>D.buildRRule({freq:'WEEKLY',interval:n,byDay:[{ord:0,day:d.getDay()}],wkst:0});const list=[['',tr('반복 안 함')],['FREQ=DAILY',tr('매일')],[weekly(1),tr('매주 {0}',[wd])],['FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR;WKST=SU',tr('평일마다 (월–금)')],[weekly(2),tr('2주마다 {0}',[wd])],['FREQ=MONTHLY',monthlyLabel('date',d)],['FREQ=MONTHLY;BYDAY='+Math.min(o.nth,4)+D.RRULE_DAYS[d.getDay()],monthlyLabel('nth',d)],o.last?['FREQ=MONTHLY;BYDAY=-1'+D.RRULE_DAYS[d.getDay()],monthlyLabel('last',d)]:null,['FREQ=YEARLY',tr('매년 {0}',[d.toLocaleDateString(I.locale(),{month:'long',day:'numeric'})])]].filter(Boolean);if(o.nth===5)list.splice(6,1);const match=list.find(([value])=>calSameRule(value,current));if(current&&!match){const rule=D.parseRRule(current);list.push([current,rule?describeRule(rule,d):current]);}list.push(['custom',tr('사용자 지정…')]);return {list,value:match?match[0]:current};}
function calSameRule(a,b){if(!a||!b)return !a&&!b;const x=D.parseRRule(a),y=D.parseRRule(b);if(!x||!y)return a===b;const days=r=>r.byDay.map(d=>d.ord+':'+d.day).sort().join();return x.freq===y.freq&&x.interval===y.interval&&days(x)===days(y)&&x.byMonthDay===y.byMonthDay&&x.count===y.count&&x.until===y.until;}
function calRepeatControl(){const c=calCard,v=c.v,e=c.event;if(e&&e.masterId&&!e.rrule&&isLocalEvent(e))return null;if(e&&!isLocalEvent(e)&&e.recurring)return h('span',{class:'card-chip static',title:tr('반복 규칙은 원래 달력 앱에서 바꿀 수 있어요.')},icon('repeat',13),tr('반복 일정'));const {list,value}=calRepeatOptions(v.start.slice(0,10),v.rrule);return h('select',{class:'card-repeat','aria-label':tr('반복'),'data-card-focus':'repeat',onchange:ev=>{const next=ev.target.value;if(next==='custom'){ev.target.value=value;calCustomRepeat();return;}v.rrule=next;if(c.mode==='edit')calCardChange({rrule:next});calRenderCard();}},list.map(([val,label],i)=>[i===1||val==='custom'?h('hr'):null,h('option',{value:val,selected:val===value?'':null},label)]));}/* hairlines: 반복 안 함 | the rules | 사용자 지정… (Apple Calendar's groups, area H) */
// ---- 알림 (1.1.3, Apple Calendar): one alert per event, minutes before the start (an all-day event's from its midnight). A new
// event on a connected calendar starts on that calendar's own default (nothing is sent); Google and Outlook keep only alerts
// before the start, so 「당일 오전 9시」 is offered on this PC's and iCloud calendars.
function calCardCalendar(){const c=calCard;return c.mode==='create'?state.calendars.find(x=>x.id===c.calendarId):calendarOf(c.event);}
function calOnDayAlerts(){const cal=calCardCalendar();return !cal||cal.provider==='local'||cal.provider==='icloud';}
function calAlertRow(view){const c=calCard,v=c.v;const label=value=>alertLabel(value,v.allDay);if(view){const a=c.event?.alert;return typeof a==='number'?h('div',{class:'card-row'},icon('bell',16),h('span',{},label(a))):null;}
  const cal=calCardCalendar();const connected=cal&&cal.provider!=='local';const values=(v.allDay?D.ALERTS_ALLDAY.filter(m=>m>=0||calOnDayAlerts()):D.ALERTS_TIMED).slice();if(typeof v.alert==='number'&&!values.includes(v.alert))values.push(v.alert);values.sort((a,b)=>a-b);
  const options=[];if(c.mode==='create'&&connected)options.push(['default',typeof cal.defaultAlert==='number'&&!v.allDay?tr('기본값 ({0})',[label(cal.defaultAlert)]):tr('달력 기본값')]);options.push(['none',tr('알림 없음')]);for(const m of values)options.push([String(m),label(m)]);
  const current=v.alert===undefined?(c.mode==='create'&&connected?'default':'none'):v.alert===null?'none':String(v.alert);
  return h('div',{class:'card-row'},icon('bell',16),h('select',{class:'card-select card-alert','aria-label':tr('알림'),'data-card-focus':'alert',onchange:ev=>{const next=ev.target.value;v.alert=next==='default'?undefined:next==='none'?null:Number(next);if(c.mode==='edit')calCardChange({alert:v.alert===undefined?null:v.alert});}},options.map(([value,text],i)=>[i&&options[i-1][0]==='none'?h('hr'):null,h('option',{value,selected:value===current?'':null},text)])));}/* a hairline under 알림 없음 (area H) */
function calCustomRepeat(){const c=calCard;const v=c.v;const start=h('input',{type:'hidden',value:v.allDay?v.start:v.start});const picker=repeatPicker(v.rrule,start,{expand:true});modal(tr('반복'),h('form',{class:'dialog-body',onsubmit:ev=>{ev.preventDefault();const next=picker.value();closeModal();if(calCard!==c)return;v.rrule=next;if(c.mode==='edit')calCardChange({rrule:next});calRenderCard();}},picker.node,actionFooter(()=>closeModal(),tr('확인'))),false,{stack:true});}
function calCardMenu(anchor){const c=calCard;const e=c.event;const r=anchor.getBoundingClientRect();contextMenu(r.left,r.bottom+4,{items:[{label:tr('복제'),icon:'copy',hint:isRecurring(e)?tr('이 일정만'):'',onClick:()=>{if(calCard!==c)return;const copy={...e,title:c.v.title.trim()||e.title,location:c.v.location,...(c.v.color?{color:c.v.color}:{}),...calTimes(c.v)};if(!c.v.color)delete copy.color;if(!closeCard(true))return;duplicateEvent(copy);}},c.mode==='edit'?'-':null,c.mode==='edit'?{label:tr('삭제'),icon:'trash',danger:true,onClick:()=>{if(calCard===c)calCardDelete();}}:null]});menuRoot?.classList.add('card-menu');}
function calCardDelete(){const c=calCard;if(!c||c.mode!=='edit')return;deleteEventFlow(c.event);}
// Saving: one change of a plain event goes out after 400ms; a repeating event keeps its changes until the card closes and
// then asks once how far they apply (Notion's pending changes).
function calCardChange(fields){const c=calCard;if(!c||c.mode!=='edit')return;Object.assign(c.pending,fields);if(c.series)return;clearTimeout(c.timer);c.timer=setTimeout(()=>calCardFlush(c).catch(()=>{}),400);}
// One write at a time. When quitting (strict, or a quit waits on this write) a failed change stays waiting for 다시 시도 and
// the failure goes to main's dialog; otherwise the card shows the stored values again (2026-10-21 review).
// Card writes on their way: a window close or the quit waits for them, and one that failed stops it with main's dialog
// (2026-10-21 review round 6: the window's X closed the card first, so its write was neither waited for nor reported).
const calWrites=new Set();
async function calCardFlush(c,strict){if(!c||c.series)return;clearTimeout(c.timer);c.timer=null;if(c.flushing)await c.flushing.catch(()=>{});const pending=c.pending;if(!Object.keys(pending).length)return;c.pending={};const job=run('event:update',{id:c.event.id,...pending});c.flushing=job;calWrites.add(job);try{const r=await job;if(calCard===c&&r&&r.id){c.event=r;c.key=r.id;const series=calSeries(r);if(series!==c.series){c.series=series;calRenderCard();}calMarkAnchor();}}catch(error){if(strict||c.strict){c.pending={...pending,...c.pending};job.requeued=true;throw error;}if(calCard===c){const back=calValuesOf(c.event);const keys=Object.keys(pending);if(keys.includes('title'))c.v.title=back.title;if(keys.includes('location'))c.v.location=back.location;if(keys.includes('color'))c.v.color=back.color;if(keys.includes('rrule'))c.v.rrule=back.rrule;if(keys.includes('alert'))c.v.alert=back.alert;if(keys.some(k=>['start','end','allDay'].includes(k))){c.v.start=back.start;c.v.end=back.end;c.v.allDay=back.allDay;}c.original={...c.original,...Object.fromEntries(keys.filter(k=>k in back).map(k=>[k,back[k]]))};if(!(c.node&&c.node.contains(document.activeElement)&&calFieldFocused()))calRenderCard();}}finally{calWrites.delete(job);if(c.flushing===job)c.flushing=null;}}
function calCommitTyped(c){const a=document.activeElement;if(c?.node?.contains(a)&&a.classList.contains('card-time'))calTypedTime(a.getAttribute('data-card-focus')==='time-end'?'end':'start',a,true);}
// New events whose save failed after their card was gone (another card opened meanwhile): kept for 「다시 시도」 and sent
// again by the closing flush, so a quit never drops them silently (Codex review 2026-10-26).
// Each new event carries a key (main makes a resend of it harmless), and one add of a payload runs at a time: the retry
// button, the closing flush and the card share the job (2026-10-26 review: a retry still on its way was sent again).
const calFailedAdds=[];const calAddJobs=new Map();
const calNewKey=()=>crypto.randomUUID().replace(/-/g,'');
// A kept add that a sync shows after all (stored, its answer lost) is done and never sent again: a resend once brought back
// an event deleted since (2026-10-26 recheck). Google keeps the key as the event's id (its series' instances as id_time),
// iCloud as its UID, and a local event's id is made from it. Checked on every state the app receives (app.js).
const calKeyId=key=>`${key.slice(0,8)}-${key.slice(8,12)}-${key.slice(12,16)}-${key.slice(16,20)}-${key.slice(20)}`;
const calAddShown=payload=>Boolean(payload.key)&&state.events.some(e=>{const id=String(e.remoteId||'');return id===payload.key||id.startsWith(payload.key+':')||id.startsWith(payload.key+'_')||e.id===calKeyId(payload.key);});
// A kept add asking for an edit (revise) still has to reach the service, shown or not (2026-10-27 recheck: it was dropped).
function calPruneFailedAdds(){for(const payload of [...calFailedAdds])if(!payload.revise&&!calAddJobs.has(payload)&&calAddShown(payload))calFailedAdds.splice(calFailedAdds.indexOf(payload),1);}
// A kept add goes out marked (main tells a failure by a Windows notification while the window is hidden); track=false sends
// it in the background, with nothing waiting for it (2026-10-26 recheck: the next window X waited for the last one).
function calSendAdd(payload,viaRun,track=true){if(calAddJobs.has(payload))return calAddJobs.get(payload);if(calFailedAdds.includes(payload)&&!payload.revise&&calAddShown(payload)){calFailedAdds.splice(calFailedAdds.indexOf(payload),1);return Promise.resolve(null);}const body=!track&&calFailedAdds.includes(payload)?{...payload,kept:true}:payload;const job=(viaRun?run('event:add',body):api.invoke('event:add',body)).then(r=>{const at=calFailedAdds.indexOf(payload);if(at>=0)calFailedAdds.splice(at,1);return r;});job.requeued=true;/* its values stay in the card or in calFailedAdds */calAddJobs.set(payload,job);if(track)calWrites.add(job);job.catch(()=>{}).finally(()=>{calAddJobs.delete(payload);calWrites.delete(job);});return job;}
// A new event's payload. Sent again from the same card with other values (the first try may have been stored with its
// answer lost) it asks the stored one to take them (revise), and keeps asking until it is saved; the same values, or a
// kept add resent later, never overwrite (2026-10-26 recheck: a resend replaced edits made since).
function calAddPayload(c,title){const payload={calendarId:c.calendarId,title,...calTimes(c.v),location:c.v.location,...(c.v.color?{color:c.v.color}:{}),...(c.v.rrule?{rrule:c.v.rrule}:{}),...(c.v.alert!==undefined?{alert:c.v.alert}:{}),key:c.addKey};if(c.sentPayload&&JSON.stringify(c.sentPayload)!==JSON.stringify(payload))c.revise=true;c.sentPayload={...payload};if(c.revise)payload.revise=true;return payload;}
function calAddFailed(payload){if(!calFailedAdds.includes(payload))calFailedAdds.push(payload);toast(tr('「{0}」 일정을 저장하지 못했어요.',[shortTitle(payload.title)]),true,{label:tr('다시 시도'),undo:false,onClick:()=>{if(calFailedAdds.includes(payload))calSendAdd(payload,true).catch(()=>calAddFailed(payload));}});}
// Only this card's ghost block goes: a new draft opened since then keeps its own.
const calDropDraft=c=>{if(!(calCard&&calCard!==c&&calCard.mode==='create'))calDraft=null;};
function calSaveNew(explicit){const c=calCard;if(!c||c.mode!=='create'||c.saving)return;calCommitTyped(c);const title=c.v.title.trim()||(explicit?tr('새 일정'):'');if(!title){calCard=null;calCardRoot().replaceChildren();calDraft=null;render();return;}c.saving=true;c.addKey||=calNewKey();const payload=calAddPayload(c,title);c.savePayload=payload;const job=calSendAdd(payload,true);c.savePromise=job;job.then(created=>{if(calCard===c){calCard=null;calCardRoot().replaceChildren();}calDropDraft(c);render();const day=D.localKey(payload.start);if(day!==selectedDate&&view==='calendar'&&calMode()==='month'){selectedDate=day;render();}const id=payload.calendarId;const cal=state.calendars.find(x=>x.id===id);if(cal&&(state.settings.hiddenCalendars||[]).includes(id))toast(tr('숨긴 달력 「{0}」에 저장했어요.',[cal.name]),false,{label:tr('달력 표시'),undo:false,onClick:()=>run('settings:update',{hiddenCalendars:(state.settings.hiddenCalendars||[]).filter(x=>x!==id)}).catch(()=>{})});void created;},()=>{c.saving=false;if(calCard===c)return;/* the card is still open: its values stay for another try */calDropDraft(c);render();calAddFailed(payload);});}
// Closing: Esc, an outside click, another event, a view change. Returns false when the card stays (a scope question is open).
function closeCard(commit=true){
  const c=calCard;if(!c)return true;if(c.closing)return false;
  if(c.mode==='create'){if(commit)calSaveNew(false);else{calCard=null;calCardRoot().replaceChildren();if(calDraft){calDraft=null;render();}}return true;}
  if(c.mode==='edit'&&commit){const active=document.activeElement;if(c.node&&c.node.contains(active)&&calFieldFocused())active.blur();}
  if(c.mode==='edit'&&commit&&c.series&&Object.keys(c.pending).length){const labels=calScopeLabels(c.event,c.pending);if(!labels.one&&!labels.future&&!labels.all){delete c.pending.rrule;toast(tr('하루 종일 변경과 반복 변경은 따로 저장해 주세요. 반복 변경은 빼고 저장했어요.'),true);}}
  if(c.mode==='edit'&&commit&&c.series&&Object.keys(c.pending).length){c.closing=true;calAskScope(tr('「{0}」 반복 일정을 어떻게 저장할까요?',[shortTitle(c.event.title)||tr('제목 없는 일정')]),calScopeLabels(c.event,c.pending)).then(scope=>{c.closing=false;if(!scope)return;const pending=c.pending;c.pending={};if(calCard===c){calCard=null;calCardRoot().replaceChildren();}const job=run('event:update',{id:c.event.id,scope,...pending});calWrites.add(job);job.catch(()=>{}).finally(()=>calWrites.delete(job));});return false;}
  if(c.mode==='edit'&&commit)calCardFlush(c).catch(()=>{});else clearTimeout(c.timer);
  const hadFocus=Boolean(c.node&&c.node.contains(document.activeElement));
  calCard=null;calCardRoot().replaceChildren();for(const n of document.querySelectorAll('.card-open'))n.classList.remove('card-open');
  const back=calFindAnchor(c);if(back&&hadFocus)back.focus({preventScroll:true});
  return true;
}
// Beside the anchor with an 8px gap (right, else left, else below or above), top-aligned, 12px inside the window.
function calPlaceCard(rect){const c=calCard;const node=c?.node;if(!node)return;if(rect)c.rect=rect;const r=c.rect;const w=node.offsetWidth||360,hgt=node.offsetHeight||320;let left,top;if(!r){left=(innerWidth-w)/2;top=Math.max(12,(innerHeight-hgt)/3);}else if(r.right+8+w<=innerWidth-12){left=r.right+8;top=r.top;}else if(r.left-8-w>=12){left=r.left-8-w;top=r.top;}else{left=Math.min(Math.max(12,r.left),innerWidth-w-12);top=r.bottom+8+hgt<=innerHeight-12?r.bottom+8:r.top-8-hgt;}top=Math.max(12,Math.min(top,innerHeight-hgt-12));node.style.left=Math.round(left)+'px';node.style.top=Math.round(top)+'px';}
const calAnchorRegions='.day-panel,.context-pane,.time-sticky,.time-body,.calendar-grid';
function calFindAnchor(c){if(!c?.key)return null;const sel='[data-event-key="'+CSS.escape(c.key)+'"]';return (c.region&&document.querySelector('#app '+c.region+' '+sel))||document.querySelector('#app '+sel);}
function calMarkAnchor(){for(const n of document.querySelectorAll('.card-open'))n.classList.remove('card-open');const c=calCard;if(!c||!c.key)return null;const anchor=calFindAnchor(c);anchor?.classList.add('card-open');return anchor;}
function calCardAfterRender(){const c=calCard;if(!c||!c.node)return;if(c.mode==='list'){if(view!=='calendar')closeCard(false);return;}const anchor=calMarkAnchor();if(anchor){calPlaceCard(anchor.getBoundingClientRect());calCardVisibility(anchor);return;}c.node.style.visibility='';/* an older-tier event is not in the saved state: its card stays */if(c.mode!=='create'&&!c.event.history){const id=c.event.id,base=c.event.masterId||id;const day=D.localKey(c.event.start);const occurrenceGone=Boolean(c.event.masterId&&c.event.rrule)&&!eventsBetween(D.dayOffset(day,-1),D.dayOffset(day,2)).some(x=>x.id===id);if(occurrenceGone||!state.events.some(x=>x.id===id||x.id===base)){if(c.hold)return;clearTimeout(c.timer);const lost=Object.keys(c.pending||{}).length>0;calCard=null;calCardRoot().replaceChildren();if(lost)toast(tr('일정이 다른 곳에서 바뀌어 카드의 변경을 저장하지 못했어요.'),true);}}}
// The card hides while its event is scrolled out of the time grid and comes back with it (Notion).
function calCardVisibility(anchor){const c=calCard;if(!c?.node)return;const scroller=anchor.closest('.time-scroll');if(!scroller){c.node.style.visibility='';return;}const r=anchor.getBoundingClientRect(),s=scroller.getBoundingClientRect();const top=s.top+(scroller.querySelector('.time-sticky')?.offsetHeight||0);const hidden=anchor.closest('.time-sticky')?false:r.bottom<top||r.top>s.bottom;c.node.style.visibility=hidden?'hidden':'';if(!hidden)calPlaceCard(r);}
document.addEventListener('pointerdown',ev=>{const c=calCard;if(!c||!c.node)return;const t=ev.target;if(c.node.contains(t)||t.closest?.('#modal-root,.context-menu,#toast'))return;const key=t.closest?.('[data-event-key]')?.dataset.eventKey;if(key&&key===c.key)return;if(key&&key!=='draft'){if(!closeCard(true))ev.cardClosed=true;return;}ev.cardClosed=true;calSuppressClick=performance.now()+400;closeCard(true);},true);

// Before the window closes or the app quits (main's flush): the card's changes go out. A new event with a title is added,
// a plain event's waiting change is sent; a repeating event's changes need the scope question, so the quit is held.
// A new event already being saved (the window's X pressed right after the card closed) is awaited, not added again; every
// card write still on its way (`calWrites`: a card the X closed, the scope answer, one the 0.4-second timer started) is
// awaited, and a failure stops the close or the quit with main's dialog (2026-10-21 reviews).
// The closing flush gathers every failure and goes on, so one failed new event never hides an open card's change from
// the quit question (2026-10-26 review). The open card and the writes under way come first, new events that failed earlier
// last: a slow resend held the card's change and the window (2026-10-26 recheck). reason: 'all' (quit, update — they are
// sent again and each failure is told), 'close' (a window hidden to the tray — they are sent without waiting and stay for
// 「다시 시도」), none (before an undo — they are left alone).
async function calFlushCard(reason){
  const errors=[];
  const tried=new Set();
  const failedLine=(payload,error)=>tr('「{0}」 일정을 저장하지 못했어요.',[shortTitle(payload.title)])+' '+error.message;
  const stillLine=payload=>tr('「{0}」 일정을 저장하지 못했어요.',[shortTitle(payload.title)])+' '+tr('아직 응답이 없어요.');
  // New events on their way get 3.5 s in all (main gives the whole flush 5): one still going is named and keeps its values,
  // instead of the quit ending on main's bare timeout (2026-10-26 recheck).
  const started=Date.now();const deadline=started+3500;
  // Only quitting has a deadline: hiding the window waits for the card's own save, so a failure is never swallowed by a
  // window that has gone (2026-10-27 recheck).
  const within=(job,until=deadline)=>reason!=='all'?job.then(()=>({ok:true}),error=>({error})):Promise.race([job.then(()=>({ok:true}),error=>({error})),new Promise(resolve=>setTimeout(()=>resolve({slow:true}),Math.max(0,until-Date.now())))]);
  const c=calCard;
  if(c&&c.mode==='create'){
    // A save under way: if another card opened meanwhile, it is a kept failure (told once, not sent again in this flush).
    if(c.saving){if(c.savePayload)tried.add(c.savePayload);const r=await within(c.savePromise);if(r.error){if(calCard===c)errors.push(tr('새 일정을 저장하지 못했어요. {0}',[r.error.message]));else if(c.savePayload&&reason==='all')errors.push(failedLine(c.savePayload,r.error));}else if(r.slow&&reason==='all'&&c.savePayload)errors.push(stillLine(c.savePayload));}
    else{calCommitTyped(c);if(c.v.title.trim()){c.addKey||=calNewKey();const payload=calAddPayload(c,c.v.title.trim());c.saving=true;c.savePayload=payload;tried.add(payload);const job=calSendAdd(payload,false);c.savePromise=job;
      // Its outcome is handled when it comes, also after the 3.5 s (the card closes, or keeps it for 「다시 시도」).
      const done=job.then(()=>{if(calCard===c){calCard=null;calCardRoot().replaceChildren();}calDropDraft(c);render();},error=>{c.saving=false;if(calCard!==c){calDropDraft(c);render();calAddFailed(payload);/* another card opened meanwhile: kept for 「다시 시도」 */}throw error;});
      const r=await within(done);
      if(r.error){if(calCard!==c){if(reason!=='close')errors.push(failedLine(payload,r.error));}else errors.push(tr('새 일정을 저장하지 못했어요. {0}',[r.error.message]));}
      else if(r.slow&&reason==='all')errors.push(stillLine(payload));}}
  }else if(c&&c.mode==='edit'){
    const a=document.activeElement;if(c.node&&c.node.contains(a)&&calFieldFocused())a.blur();
    if(c.series&&Object.keys(c.pending).length)errors.push(tr('반복 일정 카드에 저장하지 않은 변경이 있어요. 카드를 닫아 저장한 뒤 종료해 주세요.'));
    else{
      // Until nothing waits: a write the 0.4-second timer started meanwhile is awaited and, if it failed, sent again.
      c.strict=true;
      try{for(let round=0;round<5;round++){await calCardFlush(c,true);if(!c.flushing&&!Object.keys(c.pending).length)break;if(c.flushing)await c.flushing.catch(()=>{});}}
      catch(error){errors.push(tr('일정 변경을 저장하지 못했어요. {0}',[error.message]));}
      finally{c.strict=false;}
    }
  }
  // Writes under way are waited for; adds are not here (their values are kept): a slow one held the window, and on quit
  // they are given what is left of the 3.5 s below (2026-10-26 recheck).
  const adds=new Set(calAddJobs.values());
  const waiting=[...calWrites].filter(job=>!adds.has(job));
  if(waiting.length){const results=await Promise.allSettled(waiting);const failed=results.find((r,i)=>r.status==='rejected'&&!waiting[i].requeued);if(failed)errors.push(tr('일정 변경을 저장하지 못했어요. {0}',[failed.reason?.message||'']));}
  await new Promise(resolve=>setTimeout(resolve,0));/* settled adds leave calAddJobs first */
  calPruneFailedAdds();
  const kept=reason?calFailedAdds.filter(payload=>!tried.has(payload)):[];
  if(reason==='close')for(const payload of kept)calSendAdd(payload,false,false).catch(()=>calAddFailed(payload));
  else if(reason==='all'){
    // Kept adds are sent again together with those already on their way (a 「다시 시도」), all within the deadline.
    const going=[...new Set([...kept,...[...calAddJobs.keys()].filter(payload=>!tried.has(payload))])];
    const until=Math.min(Math.max(deadline,Date.now()+1000),started+4300);/* a slow edit card above leaves them a second, inside main's 5 s */
    const results=await Promise.all(going.map(payload=>within(calSendAdd(payload,false),until).then(r=>[payload,r])));
    for(const [payload,r] of results){if(r.error)errors.push(failedLine(payload,r.error));else if(r.slow)errors.push(stillLine(payload));}
  }
  if(errors.length)throw new Error(errors.join('\n'));
}
// ---- Keys (Notion, Google): D/W/M views, T today, J/K or ←/→ periods, C new event, \ panel, Esc. Matched on e.code so
// they work in 한글 input mode; never while typing or with a dialog or menu open. Returns true when the key was used.
function calendarKey(e){
  if(isWidget)return false;
  if(e.type==='keydown'&&e.key!=='Tab')calKeyboardOpen=true;
  const dialog=Boolean($('#modal-root .dialog'));
  if(e.key==='Escape'&&!dialog&&!menuRoot){
    if(calGesture?.committing){e.preventDefault();return true;}
    if(calGesture){const pressed=calGesture.started;calEndGesture();if(pressed)window.addEventListener('pointerup',()=>{calSuppressClick=performance.now()+300;},{once:true,capture:true});e.preventDefault();return true;}
    if(calCard&&search&&document.activeElement?.closest?.('.search'))return false; // Esc in the search box clears the search
    if(calCard){const a=document.activeElement;if(calCard.mode!=='create'&&calCard.node&&calCard.node.contains(a)&&calFieldFocused()){a.blur();calCard?.node?.focus({preventScroll:true});}else closeCard(calCard.mode!=='create');e.preventDefault();return true;}
    if(calDrawer&&view==='calendar'){calDrawer=false;render();e.preventDefault();return true;}
  }
  // Keys wait while a drag is held, but the scope question that follows it takes the keyboard (Enter, Space, Tab).
  if(calGesture?.started&&e.key!=='Escape'&&!(calGesture.committing&&dialog)){e.preventDefault();return true;}
  if(view!=='calendar'||dialog||menuRoot||calFieldFocused()||e.isComposing||e.altKey||e.metaKey)return false;
  if(search.trim())return false; // search results are shown in place of the calendar
  if(e.ctrlKey){if(!e.shiftKey&&(e.key==='ArrowLeft'||e.key==='ArrowRight')){e.preventDefault();calendarStep(e.key==='ArrowLeft'?-1:1);return true;}if(e.shiftKey&&e.code==='KeyT'){e.preventDefault();calGoToDate();return true;}return false;}
  if(calCard&&calCard.node?.contains(document.activeElement))return false;
  const onCell=document.activeElement?.classList?.contains('calendar-day');
  const code=e.code;
  if(!e.shiftKey&&({KeyD:'day',KeyW:'week',KeyM:'month'})[code]){e.preventDefault();setCalMode(({KeyD:'day',KeyW:'week',KeyM:'month'})[code]);return true;}
  if(!e.shiftKey&&code==='KeyT'){e.preventDefault();goToday();return true;}
  if(!e.shiftKey&&(code==='KeyJ'||code==='KeyK')){e.preventDefault();calendarStep(code==='KeyJ'?1:-1);return true;}
  if(!e.shiftKey&&code==='KeyC'){e.preventDefault();addEvent(selectedDate);return true;}
  if(code==='Backslash'){e.preventDefault();calTogglePanel();return true;}
  if(!onCell&&!e.shiftKey&&(e.key==='ArrowLeft'||e.key==='ArrowRight')&&!document.activeElement?.closest?.('.sidebar,.topbar')){e.preventDefault();calendarStep(e.key==='ArrowLeft'?-1:1);return true;}
  if(!onCell&&!e.shiftKey&&calMode()==='month'&&(e.key==='ArrowUp'||e.key==='ArrowDown')&&!document.activeElement?.closest?.('.sidebar,.topbar,.day-panel')){e.preventDefault();calWeekStep(e.key==='ArrowUp'?-1:1);return true;}
  return false;
}
document.addEventListener('pointerdown',()=>{calKeyboardOpen=false;},true);

// ---- After every render: time grid size, scroll position and the current-time line; the card follows its event ----
let calObserver=null,calNowTimer=null,calNowDay=null,calResizeSig='',calResizeTimer=null;
function calendarAfterRender(){
  calCardAfterRender();
  const g=calGesture;if(g?.committing&&g.result){if(['move','resize-start','resize-end'].includes(g.kind))calGhost(new Date(g.result.start),new Date(g.result.end),calRangeLabel(new Date(g.result.start),new Date(g.result.end)));for(const n of document.querySelectorAll('#app [data-event-key="'+CSS.escape(g.event.id)+'"]'))n.classList.add('drag-source');}
  calResizeSig=calSignature();
  const scroller=document.querySelector('.time-scroll');
  calObserver?.disconnect();calObserver=null;
  if(!scroller){clearInterval(calNowTimer);calNowTimer=null;return;}
  const mode=calMode();const timeView=scroller.closest('.time-view');
  const fit=()=>{const sticky=scroller.querySelector('.time-sticky')?.offsetHeight||0;const next=Math.max(40,Math.round((scroller.clientHeight-sticky)/12));if(next!==calHour){const minutes=scroller.scrollTop/calHour*60;calHour=next;timeView.style.setProperty('--hour',calHour+'px');scroller.scrollTop=minutes/60*calHour;}};
  fit();calObserver=new ResizeObserver(()=>fit());calObserver.observe(scroller);
  calTickNow();clearInterval(calNowTimer);calNowTimer=setInterval(calTickNow,30000);
  const other=mode==='week'?'day':'week';if(!calRecenter&&calScroll[mode]===null&&calScroll[other]!==null)calScroll[mode]=calScroll[other];
  if(calRecenter||calScroll[mode]===null){const sticky=scroller.querySelector('.time-sticky')?.offsetHeight||0;const viewport=scroller.clientHeight-sticky;const now=new Date();const minutes=calDays().includes(D.dateKey(now))?now.getHours()*60+now.getMinutes()-viewport/3/calHour*60:8*60;scroller.scrollTop=Math.max(0,minutes/60*calHour);calRecenter=false;calScroll[mode]=scroller.scrollTop/calHour*60;}
  else scroller.scrollTop=calScroll[mode]/60*calHour;
  scroller.addEventListener('scroll',()=>{const a=calCard&&calMarkAnchor();if(a)calCardVisibility(a);},{passive:true});
}
function calTickNow(){const view=document.querySelector('.time-view');if(!view)return;const now=new Date();const today=D.dateKey(now);if(calNowDay&&calNowDay!==today&&!calHolding()){calNowDay=today;render();return;}calNowDay=today;const minutes=now.getHours()*60+now.getMinutes();view.style.setProperty('--now',String(minutes/60));const pill=view.querySelector('.now-pill');if(pill)pill.textContent=calClock(now);for(const label of view.querySelectorAll('.hour-label'))label.classList.toggle('covered',Boolean(pill)&&Math.abs(Number(label.style.getPropertyValue('--at'))*60-minutes)/60*calHour<16);}
const calSignature=()=>{try{return view==='calendar'?calPanelDocked()+'|'+(calMode()==='month'?calMonthLimit():''):'';}catch{return '';}};
window.addEventListener('resize',()=>{clearTimeout(calResizeTimer);calResizeTimer=setTimeout(()=>{try{if(isWidget||!state||view!=='calendar'||calHolding())return;if(calSignature()!==calResizeSig)render();else if(calCard)calCardAfterRender();}catch{}},120);});
document.addEventListener('visibilitychange',()=>{try{if(!document.hidden&&!isWidget)calTickNow();}catch{}});
