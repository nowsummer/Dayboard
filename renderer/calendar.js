'use strict';
// Calendar screen (2026-10-21 user requests, Notion Calendar as the model): month, week and day views; the right panel that
// folds away; dragging events to move or stretch them and drawing new ones; the event card that opens beside an event.
// Loaded before app.js as a classic script. Nothing here runs at load time except declarations and window listeners, so
// app.js's globals (state, h, tr, D, I, run, render, month, selectedDate, …) are in place whenever these functions run.

// ---- State kept for this window session ----
let calTop=null;                     // month view: Sunday that starts the first row (null: the week holding the 1st of month)
const calScroll={week:null,day:null};// time grid scroll position per view
let calRecenter=false;               // the next time grid render scrolls to the current time (오늘, T); opened otherwise it starts at 9 (calendarAfterRender)
let calGesture=null;                 // pointer gesture in progress (move, stretch, draw)
let calSlide=0;                      // the next week or day grid comes in from this side (calendarStep: 1 later, -1 earlier)
let calPanelDragging=false;          // the day panel's edge held (calPanelResizer): a render waits for the release (2026-10-30 Codex review R03)
let calDrawer=false;                 // narrow window: the day panel shown over the calendar
let calAllDayOpen=false;             // all-day row shows every lane
let calHour=48;                      // hour height in px (12 hours per screen, at least 40px)
let calDraft=null;                   // new event being drawn or edited in the card: {start,end,allDay}
let calCard=null;                    // the open event card
let calSuppressClick=0;              // clicks right after a drag or after closing the card do nothing
const CAL_PANEL_MIN=900;             // the panel docks when the calendar area is this wide (the default 1180px window keeps it)
const CAL_STEP=15;                   // minutes: every drag and time list snaps to this
const CAL_ALLDAY_LINES=4;            // the week's all-day row, folded: a day keeps its tasks as chips while its lines stay within this (2026-11-11: the three bars of before and one more), else 「할 일 n」
const CAL_TASK_ROOM=40;              // px of title each of the hours' task rows keeps when side by side; narrower, they are one 「할 일 n개」 row (2026-11-11 recheck: by the room, not the count)
// The title's room in one of n task rows side by side in a group's place w px wide (styles.css .time-cluster): w/n less 2px between rows, the
// row's 5+6px padding, its 9px ring and the 5px gap after it.
const calTaskRoom=(w,n)=>w/n-27;

const calMode=()=>['month','week','day'].includes(state?.settings?.calendarView)?state.settings.calendarView:'month';
const calDays=()=>calMode()==='day'?[selectedDate]:D.weekDays(selectedDate);
const calMonthKey=d=>d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0');
// 달력에 할 일 (2026-11-11 owner, settings.calendarTasks, this PC only): 'title', the default, draws each open task as a chip of its own so the
// day's schedule reads at a glance; 'count' keeps the one 「할 일 n개」 line of before for those who liked the quieter grid. Anything else
// reads as the default, as the store heals it.
const calTaskTitles=()=>state?.settings?.calendarTasks!=='count';
const calFieldFocused=()=>{const a=document.activeElement;return Boolean(a&&(['INPUT','TEXTAREA','SELECT'].includes(a.tagName)||a.isContentEditable||a.closest?.('select')));};/* an option of an open drop-down menu is its select (area H: a save that lands while the menu is open does not re-draw the card under it) */
// A chosen destination owns the rows from this point on. Cancel the old wheel/glide before changing their origin; otherwise its
// remaining offset would be added to the newly chosen month (date form, search result, widget, or day panel). calShiftWeeks is the
// animation's internal step and deliberately does not go through this destination reset.
function calSyncMonth(){calRollReset();const d=D.fromDate(selectedDate);month=new Date(d.getFullYear(),d.getMonth(),1);calTop=null;}

// ---- Views and navigation ----
function setCalMode(mode,day){if(!['month','week','day'].includes(mode))return;if(!closeCard(true))return;calRollReset();/* in from the month: the hours start at 9 again; between week and day they stay where they are */if(mode!=='month'&&calMode()==='month'){calScroll.week=null;calScroll.day=null;calRecenter=false;}if(day){selectedDate=day;calSyncMonth();}if(mode!=='month'&&calMode()==='month'&&!day){const visible=D.cellsFrom(calStart());if(!visible.some(c=>c.key===selectedDate))selectedDate=visible.find(c=>!c.outside).key;}state.settings.calendarView=mode;render();run('settings:update',{calendarView:mode}).catch(()=>{});}
function calendarStep(n){const mode=calMode();if(mode==='month'){const base=calRollMonth();const next=new Date(base.getFullYear(),base.getMonth()+n,1);if(calGlideToMonth(next))return;closeCard(true);calRollReset();month=next;calTop=null;render();return;}closeCard(true);calSlide=n;selectedDate=D.dayOffset(selectedDate,(mode==='week'?7:1)*n);calSyncMonth();render();}
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
  modal(tr('날짜로 이동'),form,false,{live:true,noClose:true});/* 취소 is the one dismissal: no X (2026-11-02 review app-design-6) */
}
const calLongDate=key=>D.fromDate(key).toLocaleDateString(I.locale(),{year:'numeric',month:'long',day:'numeric',weekday:'long'});
function calJumpTo(key){selectedDate=key;calSyncMonth();render();}
function calStart(){const aligned=D.monthStart(month);if(!calTop)return aligned;const focus=D.cellsFrom(calTop).find(c=>!c.outside).key.slice(0,7);return focus===calMonthKey(month)?calTop:aligned;}
function calShiftWeeks(n){const top=D.dayOffset(calStart(),7*n);const focus=D.cellsFrom(top).find(c=>!c.outside).key;calTop=top;month=new Date(Number(focus.slice(0,4)),Number(focus.slice(5,7))-1,1);return top;}
function calWeekStep(n){calRollReset();const top=calShiftWeeks(n);closeCard(true);render();return top;}
function calendarTitle(){const mode=calMode();if(mode==='month')return month.toLocaleDateString(I.locale(),{year:'numeric',month:'long'});if(mode==='day'){const d=D.fromDate(selectedDate);const other=d.getFullYear()!==new Date().getFullYear();/* Korean another year's day in this year's form, 「2027년 9월 29일 (수)」 — ICU gave 「2027년 9월 29일 수」 beside 「11월 30일 (월)」 (2026-11-02 r60 integration cal-7) */if(other&&I.lang()==='ko')return d.toLocaleDateString(I.locale(),{year:'numeric',month:'long',day:'numeric'})+' ('+I.weekdays('short')[d.getDay()]+')';return d.toLocaleDateString(I.locale(),{...(other?{year:'numeric'}:{}),month:'long',day:'numeric',weekday:'short'});}// Week: the month (Notion), or both months when the week crosses into the next one — the top bar stays short.
const days=D.weekDays(selectedDate),a=D.fromDate(days[0]),b=D.fromDate(days[6]);const fmt={year:'numeric',month:'long'};if(a.getMonth()===b.getMonth())return a.toLocaleDateString(I.locale(),fmt);/* two months: short names (「Sep – Oct 2026」; Korean is short anyway) — the long ones were cut at 900px (2026-10-27 recheck) */const range={year:'numeric',month:'short'};try{return new Intl.DateTimeFormat(I.locale(),range).formatRange(a,b);}catch{return b.toLocaleDateString(I.locale(),range);}}
// English at ≤960px cut 「November 2026」 to 「November 2…」, which reads as a date (2026-11-02 review app-design-12): the title
// button holds the long name and, in data-short, the short one; calTitleFit swaps them when the long one does not fit (Korean month
// and week titles have no shorter form). The short one is a ::after, so the heading's text stays the long name for screen readers,
// tests and the smoke run. Another year's day falls back to its month, as the week title does — the day column's header shows the
// day (「Wed, Sep 29, 2027」 and 「2027년 9월 29일」 did not fit at 900px).
function calendarTitleShort(){const mode=calMode();const short={year:'numeric',month:'short'};if(mode==='month')return month.toLocaleDateString(I.locale(),short);if(mode==='day'){const d=D.fromDate(selectedDate);return d.toLocaleDateString(I.locale(),d.getFullYear()===new Date().getFullYear()?{month:'short',day:'numeric',weekday:'short'}:short);}const days=D.weekDays(selectedDate),a=D.fromDate(days[0]),b=D.fromDate(days[6]);if(a.getMonth()===b.getMonth())return a.toLocaleDateString(I.locale(),short);/* two months without the year (「Nov – Dec」, 「12월 ~ 1월」): 「Nov – Dec 2026」 and 「2026년 12월~2027년 1월」 were cut with no ▾ at 900–1000px (2026-11-02 r60 carry-over F-1) */try{return new Intl.DateTimeFormat(I.locale(),{month:'short'}).formatRange(a,b);}catch{return calendarTitle();}}
// The tiniest title (2026-11-02 owner: text size — a zoomed main window is down to 720 CSS px, the title had 8px): the month alone, this
// year's without the year (「11월」, 「Nov」), another's with two digits; the week's by its middle day, the day's by its month (the day
// column's header shows the day). Only when the short one does not fit either (calTitleFit).
// Another year's in English is 「Sep ’27」: ICU's 「Sep 27」 read as the 27th of September (2026-11-02 r60 integration cal-rr-2).
function calendarTitleTiny(){const mode=calMode();const d=mode==='month'?month:mode==='day'?D.fromDate(selectedDate):D.fromDate(D.weekDays(selectedDate)[3]);if(d.getFullYear()===new Date().getFullYear())return d.toLocaleDateString(I.locale(),{month:'short'});if(I.lang()!=='ko')return d.toLocaleDateString(I.locale(),{month:'short'})+' ’'+String(d.getFullYear()).slice(-2);return d.toLocaleDateString(I.locale(),{year:'2-digit',month:'short'});}
function calTitleNode(){return h('span',{class:'title-text','data-short':calendarTitleShort(),'data-tiny':calendarTitleTiny()},h('span',{class:'title-long'},calendarTitle()));}
// The short title while the long one and its chevron do not fit — the text cut, or the chevron wrapped away (styles.css) — measured
// after each render and window resize (2026-11-02 recheck of app-design-12: a fixed 960px breakpoint left 「Wed, September 30」 cut
// just above it, the slot narrows again when the panel docks, and another year's day was cut at every width, Korean too).
function calTitleFit(){const t=document.querySelector('#app .topbar-main h1 .title-text'),long=t?.querySelector('.title-long');if(!long)return;t.classList.remove('tight','tiny');const chevron=t.nextElementSibling;const over=()=>t.scrollWidth>t.clientWidth||(chevron&&chevron.getBoundingClientRect().top>t.getBoundingClientRect().bottom-2);const {short,tiny}=t.dataset;if(short&&short!==long.textContent&&over())t.classList.add('tight');/* then the tiny one (r60-X), measured again with the short one in place */if(tiny&&tiny!==long.textContent&&tiny!==(t.classList.contains('tight')?short:long.textContent)&&over()){t.classList.remove('tight');t.classList.add('tiny');}}
function calendarToolbar(){
  const mode=calMode(),spacer=h('span',{class:'topbar-spacer'});
  const labels={month:[tr('이전 달'),tr('다음 달')],week:[tr('이전 주'),tr('다음 주')],day:[tr('이전 날'),tr('다음 날')]}[mode];
  const names={day:tr('일간 보기'),week:tr('주간 보기'),month:tr('월간 보기')};
  // One Tab stop (the view in use); ← → ↑ ↓ change the view and keep the keyboard on it (2026-10-28 Codex review D09, C3: all three
  // were stops and the arrows did nothing). radioKeys stops the arrows here, so they never move the calendar's day. The keyboard
  // goes to the view in use afterwards, which is the old one when a card's open repeat question holds the change (setCalMode).
  const modes=['day','week','month'];
  const switcher=h('div',{class:'view-switch',role:'radiogroup','aria-label':tr('달력 보기')},[['day',tr('일'),'D'],['week',tr('주'),'W'],['month',tr('월'),'M']].map(([m,label,key],i)=>h('button',{type:'button',class:'view-switch-item'+(m===mode?' on':''),role:'radio','aria-checked':m===mode,tabindex:m===mode?0:-1,'aria-label':names[m],title:names[m]+' ('+key+')','data-short':key,/* its key letter stands for an English label below 860 CSS px (styles.css r60-X) */'data-focus-key':'view-'+m,onclick:()=>setCalMode(m),onkeydown:e=>radioKeys(e,modes.length,i,to=>{setCalMode(modes[to]);document.querySelector('.view-switch [aria-checked="true"]')?.focus({preventScroll:true});})},label)));
  const open=calPanelDocked()||calDrawer;
  // The title opens 「날짜로 이동」 (Apple Calendar's Go to Date), as clicking the month in Notion Calendar does. A small
  // muted chevron inside the same button says so (2026-10-28 Codex review D10, C4: it read as a plain heading); when the bar is
  // tight the chevron gives way first, then the text takes its ellipsis (styles.css).
  return [h('h1',{},h('button',{type:'button',class:'title-button','aria-label':calendarTitle()+', '+tr('날짜로 이동'),title:tr('날짜로 이동')+' (G)','data-focus-key':'go-date',onclick:calGoToDate},calTitleNode(),icon('chevdown',14))),h('div',{class:'inline-actions month-nav'},keyed(ib('left',labels[0],()=>calendarStep(-1)),'month-prev','J'),keyed(ib('right',labels[1],()=>calendarStep(1)),'month-next','K')),keyed(btn(tr('오늘'),goToday,'button subtle'),'month-today','T'),spacer,switcher,keyed(ib('panel',open?tr('오른쪽 패널 숨기기'):tr('오른쪽 패널 보이기'),calTogglePanel,'panel-toggle'+(open?' active':'')),'panel-toggle','/'),keyed((b=>{b.setAttribute('aria-label',tr('일정 추가'));return b;})(btn(h('span',{class:'button-label'},tr('일정 추가')),()=>addEvent(selectedDate),'button primary event-add-button','plus')),'event-add','C')];
}

// ---- The right panel: docked on a wide calendar, otherwise a drawer over it (Notion 2026-01-20) ----
function calAreaWidth(){const side=document.querySelector('.sidebar');return innerWidth-(side?side.offsetWidth:244);}
const calPanelDocked=()=>state.settings.calendarPanel!=='closed'&&calAreaWidth()>=CAL_PANEL_MIN;
function calTogglePanel(){if(!closeCard(true))return;if(calPanelDocked()){state.settings.calendarPanel='closed';calDrawer=false;render();run('settings:update',{calendarPanel:'closed'}).catch(()=>{});return;}if(calAreaWidth()>=CAL_PANEL_MIN){state.settings.calendarPanel='auto';calDrawer=false;render();run('settings:update',{calendarPanel:'auto'}).catch(()=>{});return;}calDrawer=!calDrawer;render();}
function calOpenPanelFor(day){/* a card in the panel gives way to the day (the keyboard never pressed outside it); false when it does not — a series card asking its scope (2026-11-11: a task chip then opens nothing behind the question) */if(!closeCard(true))return false;selectedDate=day;/* a day already on the month board leaves the board where the wheel left it, as a press on the day and the arrow keys do (2026-11-11 review, app.js F24: a task chip put it back on the 1st's week) */if(calMode()==='month'&&D.cellsFrom(calStart()).some(c=>c.key===day))calRollReset();else calSyncMonth();if(!calPanelDocked())calDrawer=true;render();return true;}
// A day's tasks: its date-only ones, then the timed ones by their time (2026-11-05), which each row says.
const dayTasksOf=day=>state.tasks.filter(t=>t.dueDate===day&&!t.completed).sort((a,b)=>(D.dueTimeOk(a.dueTime)?a.dueTime:'').localeCompare(D.dueTimeOk(b.dueTime)?b.dueTime:''));
function dayPanel(drawer,settled){/* an event's card in place of the day (openEventCard, 2026-11-05); its node is carried over by keepAcross */if(!drawer&&calCard?.docked&&calCard.node)return h('aside',{class:'day-panel card-docked','aria-label':tr('날짜 패널')},h('div',{'data-keep':'event'}));const dayTasks=dayTasksOf(selectedDate);/* a step of a task open here is already under it: its own line only while its task is folded or elsewhere */const open=new Set(dayTasks.filter(t=>!stepsFolded(t.id)).map(t=>t.id));const daySteps=D.stepsDueOn(state.tasks,selectedDate).filter(s=>!open.has(s.task.id));return h('aside',{class:'day-panel'+(drawer?' drawer':'')+(settled?' settled':''),'aria-label':tr('날짜 패널')},h('div',{class:'context-heading'},h('h3',{},koreanDate(selectedDate)),ib('plus',tr('이날 일정 추가'),e=>addEvent(selectedDate,e.currentTarget))),agenda(selectedDate),h('h4',{class:'agenda-sub',tabindex:-1,'data-focus-key':'day-tasks'/* the quiet place a delete by the pointer leaves the keyboard on (app.js focusPending): its rows can all be gone, steps left */},tr('할 일')),dayTasks.length||daySteps.length?h('div',{},dayTasks.map(t=>taskRow(t,'day',selectedDate)),daySteps.map(s=>stepDayRow(s))):h('p',{class:'no-events'},tr('정해진 할 일이 없어요')),quickAdd(lastTaskView,true,selectedDate),calendarList());}
// The docked panel's edge takes a drag (2026-10-29 owner: 「분계선 선을 잡고 원하는 크기 만큼 좁히거나」), as Notion Calendar's and
// Finder's sidebars do: the width follows the pointer live (a CSS variable, no redraw), is saved on release (settings.calendarPanelWidth,
// domain.js CAL_PANEL_WIDTH 220–480 and never more than 42% of the calendar, styles.css), a double-click gives back the width that
// follows the window, and ←/→ move it by 16px from the keyboard. Only the docked panel: the drawer of a narrow window keeps its 300px.
function calPanelWidth(){const w=state.settings.calendarPanelWidth;return Number.isFinite(w)?w:null;}
function calPanelSave(width){const w=width==null?null:D.panelWidth(width);if(w===(calPanelWidth()??null))return;state.settings.calendarPanelWidth=w;run('settings:update',{calendarPanelWidth:w}).catch(()=>{});render();}
function calPanelResizer(){const set=(view,w)=>{view.classList.add('panel-sized');view.style.setProperty('--cal-panel',w+'px');};const shown=()=>Math.round(document.querySelector('.calendar-view>.day-panel')?.getBoundingClientRect().width||calPanelWidth()||264);const grip=h('div',{class:'cal-panel-resizer',role:'separator','aria-orientation':'vertical','aria-label':tr('패널 너비'),'aria-valuemin':D.CAL_PANEL_WIDTH.min,'aria-valuemax':D.CAL_PANEL_WIDTH.max,'aria-valuenow':calPanelWidth(),tabindex:0,title:tr('끌어서 너비 조절 · 두 번 눌러 원래대로'),ondblclick:()=>calPanelSave(null),onkeydown:e=>{const step={ArrowLeft:16,ArrowRight:-16}[e.key];if(!step)return;e.preventDefault();e.stopPropagation();calPanelSave(shown()+step);requestAnimationFrame(()=>document.querySelector('.cal-panel-resizer')?.focus());},onpointerdown:e=>{if(e.button!==0)return;e.preventDefault();const view=grip.closest('.calendar-view');const startX=e.clientX,startW=shown();let w=startW,done=false;grip.setPointerCapture(e.pointerId);calPanelDragging=true;grip.classList.add('dragging');document.body.classList.add('col-resizing');const move=ev=>{w=D.panelWidth(startW+(startX-ev.clientX));set(view,w);};const up=()=>{if(done)return;done=true;grip.removeEventListener('pointermove',move);grip.removeEventListener('pointerup',up);grip.removeEventListener('pointercancel',up);grip.removeEventListener('lostpointercapture',up);grip.classList.remove('dragging');document.body.classList.remove('col-resizing');calPanelDragging=false;const pending=renderPending,before=calPanelWidth();renderPending=false;if(w!==startW)calPanelSave(Math.round(document.querySelector('.calendar-view>.day-panel')?.getBoundingClientRect().width||w));if((pending||w!==startW)&&calPanelWidth()===before)render();};grip.addEventListener('pointermove',move);grip.addEventListener('pointerup',up);grip.addEventListener('pointercancel',up);grip.addEventListener('lostpointercapture',up);}});return grip;}
function calendarScreen(){const docked=calPanelDocked();if(docked)calDrawer=false;const drawer=!docked&&calDrawer;const sized=docked&&calPanelWidth()!=null;return h('section',{class:'calendar-view'+(docked?'':' panel-hidden')+(drawer?' drawer-open':'')+(sized?' panel-sized':''),style:sized?{'--cal-panel':calPanelWidth()+'px'}:null},h('div',{class:'calendar-main'},search.trim()?calSearchResults():calMode()==='month'?monthBoard():timeGrid()),docked||drawer?dayPanel(drawer,drawer&&Boolean(document.querySelector('.calendar-view>.day-panel.drawer'))):null,docked?calPanelResizer():null,drawer?h('div',{class:'drawer-scrim',onpointerdown:e=>{e.preventDefault();calDrawer=false;render();}}):null);}

// ---- Search (2026-10-21 user request): events whose title or place holds the words, upcoming first then past, by day; a row
// opens that day with the event's card. Every stored event, of any year (2026-10-28 owner 「1년 전부터 가져오기」, area J — it was
// a year back to two years ahead): this PC keeps all of its own, a connected calendar what its sync read (a year back to a year
// ahead, lib/providers/common.cjs dateRange). A series lists its occurrences a year back to two years ahead and its first one
// when that lies outside, so a series of any year is found while a daily one begun in 2015 adds one row, not every day since. ----
const calStartMs=e=>e.allDay?Date.parse(String(e.start).slice(0,10)+'T00:00:00'):Date.parse(e.start);
const calEndMs=e=>e.allDay?Date.parse((String(e.end||'').slice(0,10)||D.dayOffset(String(e.start).slice(0,10),1))+'T00:00:00'):Date.parse(e.end||e.start);
let calSearchCap={words:'',up:150,past:100};
// The hits without expanding every series on each keystroke (2026-10-27 review: walking three years of 100 series took 190 ms
// of a 400 ms keystroke). An occurrence carries its master's title, place and notes, so the stored events are matched first and only
// the matching series are expanded; their expansions are kept while state.events (replaced wholesale on every change) and the
// window stay the same. Inside the window, the same hits in the same order as eventsBetween(from,to).filter(match).
let calSearchPool={events:null,from:'',series:new Map()};
function calSearchHits(words,today){
  const from=D.dayOffset(today,-365),to=D.dayOffset(today,730);
  if(calSearchPool.events!==state.events||calSearchPool.from!==from)calSearchPool={events:state.events,from,series:new Map()};
  const hidden=new Set(state.settings.hiddenCalendars||[]),out=[];
  for(const e of state.events){
    // Notes are searched too (2026-11-05), their matching line shown under the title (calSearchResults).
    if(hidden.has(e.calendarId)||!findMatches((e.title||'')+'\n'+(e.location||'')+'\n'+(e.notes||''),words).length)continue;
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
// Main's copy of the older tier as a key, for what the views (app.js historyEventsFor) and the search ask for: any account's copy
// written or dropped changes it (state.calendarHistory.rev), not only the newest time (2026-10-30 Codex review R03: a disconnected
// account whose copy was the older one stayed on screen and in the search).
function calHistoryKey(){return state.calendarHistory?.at?(state.calendarHistory.rev||state.calendarHistory.at):null;}
// The calendars whose older events may show: still here, of an account still bringing its calendars — what was asked for before a
// disconnect, a calendar switched off or one deleted at its service never shows from a copy here, whatever an answer still held (R03).
function calHistoryLive(){const on=new Set(state.accounts.filter(a=>a.syncCalendar!==false).map(a=>a.id));return new Set(state.calendars.filter(c=>c.accountId&&on.has(c.accountId)).map(c=>c.id));}
let calHistoryFind={asked:'',words:'',events:[],timer:0};
function calHistoryHits(words){
  const at=calHistoryKey();
  if(!at||!words)return [];
  // The backend caps only the visible scope. Hiding/showing or deleting a calendar must ask that scope again even when its file
  // did not change. While it answers, an unchanged data revision may keep its still-visible hits (never a newly hidden one).
  const live=calHistoryLive(),hidden=new Set(state.settings.hiddenCalendars||[]);
  const base=words+'|'+at,key=base+'|'+JSON.stringify([...live].filter(id=>!hidden.has(id)).sort());
  if(calHistoryFind.asked!==key){
    calHistoryFind.asked=key;clearTimeout(calHistoryFind.timer);
    calHistoryFind.timer=setTimeout(()=>api.invoke('calendar:history-search',{text:words}).then(r=>{if(calHistoryFind.asked!==key||calHistoryKey()!==at)return;calHistoryFind.words=base;calHistoryFind.events=Array.isArray(r?.events)?r.events:[];if(search.trim()===words&&view==='calendar')renderMain();}).catch(()=>{}),180);
  }
  if(calHistoryFind.words!==base)return [];
  return calHistoryFind.events.filter(e=>live.has(e.calendarId)&&!hidden.has(e.calendarId));
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
  const row=e=>{const note=e.notes?matchLine(e.notes,words):null;return h('button',{type:'button',class:'search-hit'+(calPast(e)?' past':''),'data-event-key':e.id,onclick:()=>calOpenSearchHit(e),oncontextmenu:ev=>{ev.preventDefault();eventMenu(e,ev.clientX,ev.clientY);}},h('i',{class:'search-hit-bar',style:{background:eventColor(e)}}),h('span',{class:'search-hit-time'},timeLabel(e)),h('strong',{},markedText(e.title||tr('제목 없는 일정'),words)),e.location?h('span',{class:'search-hit-place'},markedText(e.location,words)):null,note?h('span',{class:'search-hit-note'},markedText(note.line,words)):null);};
  const group=list=>{const out=[];let day=null;for(const e of list){const key=D.localKey(e.start);if(key!==day){day=key;out.push(h('h4',{class:'search-day'},dayLabel(key)));}out.push(row(e));}return out;};
  return h('div',{class:'calendar-search'},h('div',{class:'search-head'},h('strong',{},tr('「{0}」 일정 {1}개',[words,hits.length])),btn(tr('검색 지우기'),()=>{search='';const box=document.querySelector('.search input');if(box){box.value='';box.blur();}render();},'button subtle')),
    upcoming.length?h('section',{'data-part':'up'},h('h3',{},tr('다가오는 일정')),group(upcoming),more(upAll.length-upcoming.length,'up')):null,past.length?h('section',{'data-part':'past'},h('h3',{},tr('지난 일정')),group(past),more(pastAll.length-past.length,'past')):null,
    hits.length?null:h('p',{class:'no-events'},tr('맞는 일정이 없어요. 제목·장소·메모에서 찾아요.')));
}
function calOpenSearchHit(e){if(!closeCard(true))return;const day=D.localKey(e.start);search='';const box=document.querySelector('.search input');if(box){box.value='';if(document.activeElement===box)box.blur();}selectedDate=day;calSyncMonth();render();const anchor=document.querySelector('#app .calendar-main [data-event-key="'+CSS.escape(e.id)+'"]');anchor?.scrollIntoView?.({block:'center'});openEventCard(e,anchor,anchor?null:undefined,{dock:true});}

// ---- Month view ----
// Rows of event chips that fit a cell (the 할 일 line counts as one), so tall windows show more and short ones never clip.
// Rows that fit under a cell's date header; a half row never shows — the rest folds into 「+N개」 (2026-10-26 review). Measured
// (2026-11-02 review app-design-1, usability-6): header = border 1 + pad 6 + number 27 + gap 5 = 39px, a row = chip 20.2 + gap 2 =
// 22.2px, so 41 = header + bottom pad 4 − the last row's gap 2 (pads 6/4 in styles.css r60-F): 1180×780 → 3, 650px → 2, never fewer.
function calMonthLimit(){const viewport=document.querySelector('#app .calendar-grid.rolling .month-viewport');const cellH=viewport?viewport.clientHeight/6:(innerHeight-56-16-24-34)/6;return Math.max(1,Math.floor((cellH-41)/22.2));}/* one line at the least (r60-X, 2026-11-02 owner: text size): at 더 크게 the 650 DIP minimum is 520 CSS px, cells 65.9px — two lines were cut */
const calFirstLabel=key=>D.fromDate(key).toLocaleDateString(I.locale(),{month:'short',day:'numeric'});const calFirstMonth=key=>D.fromDate(key).toLocaleDateString(I.locale(),{month:'short'});
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
// The month board (2026-10-30 owner: 「노션 캘린더의 경우 달력(월간)에서 스크롤을 내려서 한 줄이 내려갈 때 줄이 연속적으로 내려가서 끊김이 없어보이고
// 유려해보이는데, 지금 Dayboard는 한 칸이 그냥 바로 내려가서 너무 확확 전환되고 연속성이 없어 보여」): the weekday header, and the weeks in a
// viewport six rows high that clips them. At rest exactly the six weeks (one Tab stop, the counts and keys as before); while the rows
// move (calRoll below) one more week above and below, slid by the scrolled pixels (--shift).
function monthBoard(buffer=calRoll.moving?1:0){
  const top=calStart(),focus=D.dayOffset(top,20).slice(0,7),from=D.dayOffset(top,-7*buffer),rows=6+2*buffer;
  const cells=Array.from({length:7*rows},(_,i)=>{const key=D.dayOffset(from,i);return {key,day:Number(key.slice(8)),outside:key.slice(0,7)!==focus};});
  const pool=eventsBetween(cells[0].key,D.dayOffset(cells.at(-1).key,1));const byDay=calDayBuckets(pool,cells);/* a task once a day in the month (2026-11-11 review: one chip for each time of its subtasks filled a cell with the same name, their times hidden at that width) */const today=D.dateKey();const limit=calMonthLimit();/* the tasks bucketed once too, not filtered per cell (2026-11-11) */const titles=calTaskTitles();const taskDays=titles?D.taskBuckets(state.tasks,cells.map(c=>c.key),{oneADay:true}):null;
  // One Tab stop in the grid (2026-10-28 Codex review D09, C2: 42 day stops, then every chip and 「+n개」 of the month): the selected
  // day, and after it that day's own chips; the arrow keys (app.js keydown) still walk the days, and a chip still takes a click.
  const stop=gridTabStop(cells);
  // An event over several days is one bar across its days, a piece per week (2026-11-08 owner, as Apple Calendar and Notion Calendar): the top lines of a week, and the
  // cells leave their room. One line is kept for 「+n개」 or 할 일; a bar without a lane stays a chip in each day, as all of them were.
  const weeks=Array.from({length:rows},(_,w)=>{const keys=cells.slice(w*7,w*7+7).map(c=>c.key);const wide=[...new Set(keys.flatMap(k=>byDay.get(k)))].filter(calWide);const bars=D.spanLayout(wide,keys).bars;/* a range being made is on top in any window, the others under it: it must not go when the pointer lets go (Codex third check N1) */const draft=calDraft?.allDay?D.spanLayout([{id:'draft',allDay:true,start:calDraft.start,end:calDraft.end,title:''}],keys).bars[0]:null;if(draft){for(const b of bars)b.lane++;bars.unshift(draft);}return {keys,bars:bars.filter(b=>b===draft||b.lane<limit-1)};});
  const cellNodes=cells.map((d,i)=>{
    const week=weeks[Math.floor(i/7)],col=i%7;const here=week.bars.filter(b=>b.from<=col&&b.to>=col);const lanes=here.length?Math.max(...here.map(b=>b.lane))+1:0;const inBar=new Set(here.map(b=>b.event.id));
    const dayEvents=byDay.get(d.key);const events=dayEvents.filter(e=>!inBar.has(e.id));const tasks=titles?taskDays.get(d.key):calDayTodos(d.key);
    // A line budget, no more: the 할 일 line takes one, 「+n개」 one, chips the rest (0 is fine — Apple Calendar shows counts only in
    // narrow cells); a chip was kept at any price and the third line was cut in half at 650px (2026-11-02 review app-design-1, usability-6).
    // With the tasks as chips (2026-11-11) there is one budget for every chip, events and tasks alike in D.dayItems' order, and no line is kept
    // for 할 일: what does not fit folds into 「+n개」, whose list names the tasks too. The count way below is the one of before.
    /* the range being made may take the last line */const full=lanes>=limit;let shown,taskLine=false,budget;
    if(titles){const items=D.dayItems(events,tasks);budget=limit-lanes;shown=full?[]:items.length>budget?items.slice(0,Math.max(0,budget-1)):items;}
    else{budget=limit-lanes-(tasks.length?1:0);shown=(full?[]:events.length>budget?(budget===0&&events.length===1?events:events.slice(0,Math.max(0,budget-1))):events).map(event=>({event}));taskLine=!full&&tasks.length&&(budget>0||!events.length);}// budget 0 (limit 1 with tasks: a zoomed 520 CSS px window, r60-X): the one line is the day's only event's chip (not 「+1개」 hiding its title — 2026-11-02 r60 integration cal-6), 「+n개」 from two events, or the 할 일 line when there is no event
    const more=full?0:events.length+(titles?tasks.length:0)-shown.length;const off=d.key===stop?null:-1;
    return h('div',{class:'calendar-day'+(d.outside?' outside':'')+(i%7===0||i%7===6?' weekend':'')+(d.key===today?' is-today':'')+(d.key===selectedDate?' is-selected':''),role:'button',tabindex:d.key===stop?0:-1,'aria-label':koreanDate(d.key)+(dayEvents.length?tr(" · 일정 {0}개", [dayEvents.length]):'')+(titles&&tasks.length?tr(" · 할 일 {0}개", [tasks.length]):''),'data-focus-key':'day-'+d.key,'data-day':d.key,title:tr('두 번 누르면 일정 추가'),style:{gridColumn:String(col+1),gridRow:String(Math.floor(i/7)+1)},
      onpointerdown:e=>{/* drawn across empty days: a new event over them */if(e.target.closest?.('.day-event,.day-task,.day-more,.day-tasks,.day-number')||!writableCalendars().length)return;calPointerDown(e,{kind:'month-draw',day:d.key});},
      onclick:e=>{if(performance.now()<calSuppressClick||e.detail>=2)return;selectedDate=d.key;render();},ondblclick:e=>{if(performance.now()<calSuppressClick)return;selectedDate=d.key;addEvent(d.key,e.currentTarget);},
      onkeydown:e=>{if((e.key==='Enter'||e.key===' ')&&e.target===e.currentTarget){e.preventDefault();selectedDate=d.key;render();document.querySelector('[data-focus-key="day-'+d.key+'"]')?.focus({preventScroll:true});}}},
      h('button',{type:'button',class:'day-number',tabindex:-1,title:tr('일간 보기'),'aria-label':d.day===1?calFirstLabel(d.key):null,style:D.discInk(d.day),onclick:e=>{e.stopPropagation();setCalMode('day',d.key);}},d.day),d.day===1?h('span',{class:'day-month','aria-hidden':'true'},calFirstMonth(d.key)):null,
      h('div',{class:'day-items'},lanes?h('i',{class:'day-lanes',style:{'--lanes':lanes}}):null,shown.map(x=>{const chip=x.task?calTaskChip(x.task,d.key):calChip(x.event,d.key);if(off)chip.tabIndex=off;return chip;}),more?h('button',{type:'button',class:'day-more',tabindex:off,'data-focus-key':'more-'+d.key,onclick:ev=>{ev.stopPropagation();calDayList(d.key,ev.currentTarget);}},tr("+{0}개", [more])):null,taskLine?h('button',{type:'button',class:'day-tasks',tabindex:off,'data-focus-key':'tasks-'+d.key,onclick:ev=>{ev.stopPropagation();calOpenPanelFor(d.key);}},tr("할 일 {0}개", [tasks.length])):null));
  });
  const days=h('div',{class:'month-rows',style:{'--rows':rows,'--buffer':buffer,'--shift':(buffer?calRoll.off:0).toFixed(2)+'px'}},weeks.map((week,w)=>[cellNodes.slice(w*7,w*7+7),week.bars.map(b=>b.event.id==='draft'?calMonthDraft(week.keys,w,b.lane):calMonthBar(b,week.keys,w,stop))]));
  /* task-titles (2026-11-11 review): with tasks as chips, an event chip keeps its bar in the ring's 9px place, so one cell's times and titles start on one column (styles.css) */
  const grid=h('div',{class:'calendar-grid large rolling'+(buffer?' moving':'')+(titles?' task-titles':'')},h('div',{class:'month-weekdays'},I.weekdays('short').map((d,i)=>h('div',{class:'weekday'+(i===0?' sunday':'')+(i===6?' saturday':'')+(i===0||i===6?' weekend':'')},d))),h('div',{class:'month-viewport'},days));
  grid.addEventListener('wheel',calMonthWheel,{passive:false});
  return grid;
}
// A day's 「할 일 n개」 counts what the day panel lists (2026-11-09 V22: 5 in the cell, 4 in the panel): its open tasks, and a step dated that day only
// where it is a line of its own there — its task due another day, or folded.
function calDayTodos(key){const due=state.tasks.filter(t=>t.dueDate===key&&!t.completed);const open=new Set(due.filter(t=>!stepsFolded(t.id)).map(t=>t.id));return [...due,...D.stepsDueOn(state.tasks,key).filter(s=>!open.has(s.task.id))];}
// A task in the grid (2026-11-11 owner: 「할 일 내용도 표기해주는 게 스케줄 인식하기에 좋지 않을까?」 → the Apple and Google Calendar way): a hollow
// circle in its list's colour where an event chip has its bar, so the two never read alike; the time in the event chips' grey when it has
// one (the month only: the week draws it at its time), and the title. kind 'month' a chip in a day cell, 'allday' one in the week's all-day
// row, 'time' a one-line row at its time in the hours (place: its layout). A press opens the day in the right panel and then the task
// (calOpenTask); nothing completes from here — a target this small would tick by accident — and nothing drags in this version.
// Its subtasks never get chips of their own (they would crowd the day): the tooltip counts them, and a day holding only a subtask's date
// holds the task's chip, its tooltip naming the subtask (D.taskBuckets); a subtask with a time holds it at that time (2026-11-11), its focus key
// and its item in the hours carrying the time (stepTime), as the task may stand at two times of a day. Its focus key starts as a month chip's, so render() falls back to
// that day's 「+n개」 when it folds away. data-todo-id, not data-task-id: the list rows answer to that (the quick add's row lookup)
function calTaskChip(t,day,kind='month',place=null){const at=D.dueAt(t);const tip=calTaskTip(t);return h('span',{class:kind==='time'?'time-task':kind==='allday'?'allday-task':'day-task',role:'button',tabindex:0,'data-todo-id':t.id,'data-focus-key':'chip-todo-'+t.id+(kind!=='month'&&t.stepTime?'~'+t.stepTime:'')+'@'+day,title:tip,'aria-label':tip,style:{'--task-color':listColor(listBy(t.listId)),...(place||{})},
  onclick:ev=>{ev.stopPropagation();if(performance.now()<calSuppressClick)return;calOpenTask(t,day,ev);},ondblclick:ev=>ev.stopPropagation(),
  onkeydown:ev=>{if(ev.key==='Enter'||ev.key===' '){ev.preventDefault();ev.stopPropagation();calOpenTask(t,day,ev);}}},
  h('i',{class:'task-ring','aria-hidden':'true'}),kind==='month'&&at?h('span',{class:'chip-time'},fmtTime(at,'month')):null,h('span',{class:'chip-title'},t.title));}
// A task in 「+n개」's list: its circle where an event has its bar, the title, then its time (or the day's subtasks) and list.
function calTaskLine(t,day){const at=calOwnAt(t);const l=listBy(t.listId);return h('button',{type:'button',class:'event-row task-line','data-todo-id':t.id,title:calTaskTip(t),onclick:ev=>{closeCard(true);calOpenTask(t,day,ev);}},h('i',{class:'task-ring','aria-hidden':'true',style:{'--task-color':listColor(l)}}),h('div',{},h('strong',{},t.title),h('span',{},[at?fmtTime(at):'',calStepsDue(t),l?listVisual(l).title:tr('할 일')].filter(Boolean).join(' · '))));}
// The chip's tooltip and name (2026-11-11): the title, the time (12 or 24 hours as set), the list, and 「하위 할 일 1/2」 — done of all — when it has
// subtasks, which have no chips; on a day it holds for its subtasks' dates (D.taskBuckets stepsDue) 「하위 할 일 「초안」」 instead — two or more
// counted, 「하위 할 일 2개 「초안, 표」」, so the English says 2 subtasks (2026-11-11 recheck: 'Subtask “Draft, Table”' was singular for two).
// A subtask's time goes with the subtask's name, not where the task's own time stands (2026-11-11 review: 「보고 · 오후 3:00 · …」 read as the
// task's): 「하위 할 일 「초안」 오후 3:00」, one time after the names when they share it, else each name with its own.
const calStepsDue=t=>{const due=t.stepsDue||[];if(!due.length)return '';const times=due.map(x=>{const at=D.dueAt(D.stepWhen(x));return at?fmtTime(at):'';});const shared=times.every(v=>v===times[0]);const names=due.map((x,i)=>x.title+(!shared&&times[i]?' '+times[i]:'')).join(', ');const said=due.length===1?tr('하위 할 일 「{0}」',[names]):tr('하위 할 일 {0}개 「{1}」',[due.length,names]);return shared&&times[0]?said+' '+times[0]:said;};
// The task's own time, where a copy of it stands for its subtasks (D.taskBuckets): its own on its own day (ownTime), else none.
const calOwnAt=t=>t.stepsDue?(t.ownTime?D.dueAt({dueDate:t.dueDate,dueTime:t.ownTime}):null):D.dueAt(t);
function calTaskTip(t){const at=calOwnAt(t);const steps=Array.isArray(t.steps)?t.steps:[];const l=listBy(t.listId);return [t.title,at?fmtTime(at):'',l?listVisual(l).title:'',t.stepsDue?calStepsDue(t):steps.length?tr('하위 할 일 {0}/{1}',[steps.filter(x=>x.completed).length,steps.length]):''].filter(Boolean).join(' · ');}
// A chip pressed: the day in the right panel, then the stored task opened at once (2026-11-11 review: a click waited TASK_DOUBLE every time, while
// its panel row opens a task without subtasks at once — the chip has no double click of its own to wait for). A mouse press keeps the whole
// overlay quiet for that time, the sheet included (app.js sheetQuietUntil): a double click's second press lands there — on the backdrop it
// closed the sheet, on the sheet it pressed what was under the pointer (2026-11-11 recheck: 날짜 없음 emptied the date).
// A card that does not give way (a series card asking its scope) keeps everything where it is.
function calOpenTask(t,day,ev){if(!calOpenPanelFor(day))return;const now=state.tasks.find(x=>x.id===t.id);if(!now)return;if(ev?.detail>=1)sheetQuietUntil=performance.now()+SHEET_QUIET;taskTextClick(ev,now,false);}
// A month chip: the shared chip plus dragging to another day. Its focus key (with 「+n개」 'more-' and 「할 일 n개」 'tasks-' above) keeps the
// keyboard on it through a render, as the week blocks' do; render() falls back to 「+n개」, then the day cell (2026-11-02 r60 integration cal-4).
function calChip(e,day,ends){const chip=eventChip(e,day);chip.dataset.eventKey=e.id;chip.dataset.focusKey='chip-'+e.id+'@'+day;chip.addEventListener('pointerdown',ev=>calPointerDown(ev,{kind:'month',event:e,day:calCellAt(ev.clientX,ev.clientY)?.dataset.day||day}));if(!canEditEvent(e))chip.classList.add('readonly');if(calPast(e))chip.classList.add('past');return calEdges(chip,e,'month-stretch',ends);}
// The last day an event shows on, and whether it runs over several: what a bar is drawn for. A short night event stays a chip, as it stays a block in the week.
const calLastDay=e=>e.allDay?D.dayOffset(String(e.end||'').slice(0,10)||D.dayOffset(String(e.start).slice(0,10),1),-1):D.dateKey(new Date(new Date(e.end||e.start).getTime()-1));
const calWide=e=>D.spansDays(e)&&calLastDay(e)>D.localKey(e.start);
// The ends of an event take a drag to other days (Notion's help: hover over the left or right edge, then drag). Only a true end: a piece that goes on has none.
function calEdges(node,e,kind,{start=true,end=true}={}){if(!canEditEvent(e))return node;for(const [side,on] of [['start',start],['end',end]])if(on)node.append(h('i',{class:'chip-edge '+side,'aria-hidden':'true',onpointerdown:ev=>calPointerDown(ev,{kind,side,event:e})}));return node;}
function calMonthBar(b,keys,row,stop){const chip=calChip(b.event,keys[b.from],{start:!b.before,end:!b.after});chip.classList.remove('timed');chip.classList.add('allday','month-bar');if(b.before)chip.classList.add('cont-before');if(b.after)chip.classList.add('cont-after');chip.style.gridColumn=(b.from+1)+' / '+(b.to+2);chip.style.gridRow=String(row+1);chip.style.setProperty('--lane',String(b.lane));chip.tabIndex=keys.slice(b.from,b.to+1).includes(stop)?0:-1;return chip;}
// A range drawn over the weeks: a piece per week it touches, flat where it goes on, so a bar from Friday to Wednesday reads as one.
function calMonthPiece(from,to,keys,row,lane,cls,title,color){const a=from<keys[0]?keys[0]:from,b=to>keys[6]?keys[6]:to;if(a>b)return null;return h('div',{class:'day-event allday month-bar '+cls+(from<keys[0]?' cont-before':'')+(to>keys[6]?' cont-after':''),style:{gridColumn:(keys.indexOf(a)+1)+' / '+(keys.indexOf(b)+2),gridRow:String(row+1),'--lane':lane,'--cal-color':color}},h('span',{class:'chip-title'},title));}
function calMonthDraft(keys,row,lane){const piece=calMonthPiece(calDraft.start,D.dayOffset(calDraft.end,-1),keys,row,lane,'draft',calCard?.title||tr('새 일정'),null);if(piece)piece.dataset.eventKey='draft';return piece;}
function calMonthGhost(from,to,title,color,lane=0){for(const n of document.querySelectorAll('.month-bar.ghost'))n.remove();const board=document.querySelector('#app .month-rows');if(!board||!from)return;const keys=[...board.querySelectorAll('.calendar-day[data-day]')].map(n=>n.dataset.day);for(let w=0;w*7<keys.length;w++){const piece=calMonthPiece(from,to,keys.slice(w*7,w*7+7),w,lane,'ghost'+(color?'':' draft'),title,color);if(piece)board.append(piece);}}
// The day under the pointer: a bar lies over the cells.
const calCellAt=(x,y)=>document.elementsFromPoint?.(x,y)?.find(n=>n.matches?.('.calendar-day[data-day]'))||null;
// "+N개": the day's events in a small list beside the cell; a row opens the event card.
function calDayList(day,anchor){const events=eventsOn(day);/* the tasks folded into 「+n개」 are named here too, in the cell's order (2026-11-11) */const items=calTaskTitles()?D.dayItems(events,D.taskBuckets(state.tasks,[day],{oneADay:true}).get(day)):events.map(event=>({event}));if(!closeCard(true))return;calCard={mode:'list',day,key:null,node:null,anchor};const node=h('div',{class:'event-card day-list',role:'dialog','aria-label':koreanDate(day),tabindex:-1},h('header',{class:'card-head'},h('strong',{},koreanDate(day)),ib('close',tr('닫기'),()=>closeCard(true))),h('div',{class:'agenda'},items.map(({event:e,task})=>task?calTaskLine(task,day):h('button',{type:'button',class:'event-row','data-event-key':e.id,onclick:ev=>{const rect=calCard?.node?.getBoundingClientRect()||ev.currentTarget.getBoundingClientRect();closeCard(true);openEventCard(e,null,rect,{dock:true});}},h('span',{class:'event-line',style:{background:eventColor(e)}}),h('div',{},h('strong',{},e.title),h('span',{},timeLabel(e)))))));calCard.node=node;calCardRoot().replaceChildren(node);calPlaceCard(anchor.getBoundingClientRect());node.focus({preventScroll:true});}
// The month view's scroll, as Notion Calendar's (2026-10-30 owner: 「한 칸이 그냥 바로 내려가서 너무 확확 전환되고 연속성이 없어 보여」): the
// rows move by the pixel instead of jumping a week at a time. off: how far the rows have moved past calStart()'s week (later weeks:
// positive), target: where they are going. The wheel and the trackpad move the target (a wheel's notch is a week; a trackpad's pixels,
// 100 to a week) and the rows ease after it every frame, by time, so the speed does not depend on the frame rate. The arrow keys, the
// month buttons and 오늘 glide there from rest on a critically damped spring (calGlide — starts and stops softly, as Apple's; when the
// rows are already moving they ease after the new target instead, so a held key does not stutter). Each time a whole row has passed,
// calTop moves a week (the title follows) and the strip is rebuilt around it; once the wheel stops the target rounds to a week edge,
// and settled there the view is drawn at rest. Within one gesture the rows still stop where a month's 1st reaches the top (as before).
// With Windows' 「애니메이션 효과」 off (prefers-reduced-motion) the rows land at once.
const CAL_ROLL={off:0,target:0,frame:0,time:0,idle:0,hold:false,wheel:false,moving:false,glide:null};
let calRoll={...CAL_ROLL};
const calReduceMotion=()=>matchMedia('(prefers-reduced-motion: reduce)').matches;
function calRowHeight(){const vp=document.querySelector('#app .calendar-grid.rolling .month-viewport');return vp?vp.clientHeight/6:0;}
function calRollReset(){cancelAnimationFrame(calRoll.frame);clearTimeout(calRoll.idle);calRoll={...CAL_ROLL};}
// The strip with the extra weeks, built anew (a row passed, or the motion began; a focused day keeps the focus); the title follows the rows.
function calRollStrip(){const old=document.querySelector('#app .calendar-grid.large.rolling');if(old){const had=old.contains(document.activeElement)?document.activeElement.dataset.focusKey||'':null;const board=monthBoard(1);old.replaceWith(board);if(had!==null)(board.querySelector('[data-focus-key="'+CSS.escape(had)+'"]')||board.querySelector('.calendar-day[tabindex="0"]'))?.focus({preventScroll:true});}const title=document.querySelector('.topbar h1 .title-text');if(title&&title.querySelector('.title-long')?.textContent!==calendarTitle()){const button=title.closest('button');title.replaceWith(calTitleNode());calTitleFit();button?.setAttribute('aria-label',calendarTitle()+', '+tr('날짜로 이동'));}}
function calRollGo(){const s=calRoll;if(!s.moving){s.moving=true;calRollStrip();}if(!s.frame){s.time=performance.now();s.frame=requestAnimationFrame(calRollFrame);}}
function calRollFrame(now){
  const s=calRoll;s.frame=0;const row=calRowHeight();
  if(!row||isWidget||view!=='calendar'||calMode()!=='month'||!document.querySelector('#app .calendar-grid.rolling.moving')){calRollReset();return;}
  const dt=Math.min(48,Math.max(0,now-s.time));s.time=now;const g=s.glide;
  if(calReduceMotion()){s.off=s.target;s.glide=null;}
  else if(g){const t=Math.min(1,(now-g.at)/g.ms),w=9.2*t;s.off=t>=1?s.target:g.from+(s.target-g.from)*(1-(1+w)*Math.exp(-w));if(t>=1)s.glide=null;}
  else{s.off+=(s.target-s.off)*(1-Math.exp(-dt/65));if(Math.abs(s.target-s.off)<0.35)s.off=s.target;}
  let passed=0;
  while(s.off>=row-0.01){s.off-=row;s.target-=row;if(s.glide)s.glide.from-=row;calShiftWeeks(1);passed++;}
  while(s.off<=-row+0.01){s.off+=row;s.target+=row;if(s.glide)s.glide.from+=row;calShiftWeeks(-1);passed++;}
  if(passed)calRollStrip();else document.querySelector('#app .calendar-grid.rolling .month-rows')?.style.setProperty('--shift',s.off.toFixed(2)+'px');
  if(s.off!==s.target||s.wheel||s.glide){s.frame=requestAnimationFrame(calRollFrame);return;}
  // Settled on a week edge: drawn at rest (six weeks, the card anchors and the keys as before).
  s.moving=false;s.off=s.target=0;render();
}
// The wheel stopped: the destination rounds to a week edge.
function calRollIdle(){const s=calRoll,row=calRowHeight();s.wheel=false;s.hold=false;if(row)s.target=Math.round(s.target/row)*row;if(s.moving||s.target)calRollGo();}
function calMonthWheel(e){
  if(calCard?.mode==='create')return;// a new event's card: one stray scroll closed and saved it (2026-11-09 F75)
  if(e.ctrlKey||Math.abs(e.deltaX)>Math.abs(e.deltaY))return;e.preventDefault();
  const s=calRoll,row=calRowHeight();if(!row||calGesture)return;
  clearTimeout(s.idle);s.idle=setTimeout(calRollIdle,160);s.wheel=true;
  if(s.hold)return;
  if(!s.moving&&!closeCard(true))return;
  s.glide=null;
  // A mouse wheel's notch (wheelDelta in steps of 120) is a whole week from the week edge the rows are going to; a trackpad and a
  // smooth-scrolling wheel move by their pixels. The way comes from deltaY (wheelDelta's sign is not the same in every source).
  const notch=e.deltaY&&e.wheelDeltaY&&e.wheelDeltaY%120===0?Math.sign(e.deltaY)*Math.abs(e.wheelDeltaY)/120:0;
  const dy=e.deltaMode===1?e.deltaY*40:e.deltaMode===2?e.deltaY*innerHeight:e.deltaY;
  s.target=notch?(Math.round(s.target/row)+notch)*row:s.target+dy*row/100;
  // The first week ahead (in the way the rows go) that holds a month's 1st stops this gesture there.
  const dir=Math.sign(s.target),whole=Math.floor(Math.abs(s.target)/row+1e-6);
  for(let k=1;k<=whole;k++){if(D.cellsFrom(D.dayOffset(calStart(),7*dir*k)).slice(0,7).some(c=>c.day===1)){s.target=dir*k*row;s.hold=true;break;}}
  calRollGo();
}
// Gliding n weeks (the arrow keys, the month buttons, 오늘): false when the month view is not on screen or it is too far to glide (a jump).
function calGlide(n){
  const s=calRoll,row=calRowHeight();if(!row||!n||Math.abs(n)>8||isWidget||view!=='calendar'||calMode()!=='month'||calGesture)return false;
  if(!s.moving&&!closeCard(true))return true;
  const rest=!s.moving||(s.off===s.target&&!s.wheel&&!s.glide);
  s.target=(Math.round(s.target/row)+n)*row;s.wheel=false;s.hold=false;clearTimeout(s.idle);
  s.glide=rest?{from:s.off,at:performance.now(),ms:Math.min(560,280+45*Math.abs(n))}:null;
  calRollGo();return true;
}
// The month the rows rest on once they stop (the one on screen when they are still).
function calRollMonth(){const row=calRowHeight();const top=row&&calRoll.moving?D.dayOffset(calStart(),7*Math.round(calRoll.target/row)):calStart();const key=D.cellsFrom(top).find(c=>!c.outside).key;return new Date(Number(key.slice(0,4)),Number(key.slice(5,7))-1,1);}
// To the week that holds a month's 1st (the month buttons, J/K, 오늘), gliding when it is near; already on the way there, nothing more.
function calGlideToMonth(date){const target=D.monthStart(new Date(date.getFullYear(),date.getMonth(),1));const weeks=Math.round((D.fromDate(target)-D.fromDate(calStart()))/604800000)-Math.round(calRoll.target/(calRowHeight()||1));if(!weeks)return calRoll.moving;return calGlide(weeks);}

// ---- Week and day views ----
const calPast=e=>e.allDay?String(e.end||'').slice(0,10)<=D.dateKey():new Date(e.end||e.start)<new Date();
// The current time in the gutter pill: the clock without 오전/오후 (the hour labels around it say which), so it fits.
const calClock=d=>timeFormat()==='24h'?fmtTime(d):(d.getHours()%12||12)+':'+String(d.getMinutes()).padStart(2,'0');
function calHourLabel(hour){const d=new Date(2000,0,1,hour);return fmtTime(d,true);}
// A sideways swipe on the trackpad (or Shift+wheel) over the week and day grids turns one page — the next or the previous week or day —
// once per gesture, as Apple Calendar does (2026-10-30 owner: 「애플에서 만든 프로그램들 처럼 작동성 등이 유려하고 미려하도록」).
let calSwipe={acc:0,idle:0,done:false};
function calTimeWheel(e){if(calCard?.mode==='create')return;/* a new event's card stays (2026-11-09 F75) */if(e.ctrlKey||Math.abs(e.deltaX)<=Math.abs(e.deltaY))return;e.preventDefault();const s=calSwipe;clearTimeout(s.idle);s.idle=setTimeout(()=>{s.acc=0;s.done=false;},220);if(s.done||calGesture)return;s.acc+=e.deltaX;if(Math.abs(s.acc)<80)return;s.done=true;calendarStep(Math.sign(s.acc));}
function timeGrid(){
  const mode=calMode(),days=calDays(),today=D.dateKey();
  const pool=eventsBetween(days[0],D.dayOffset(days[days.length-1],1));
  const spans=pool.filter(D.spansDays),timed=pool.filter(e=>!D.spansDays(e));
  const minMinutes=Math.ceil(22/calHour*60);
  const head=h('div',{class:'time-head'},h('div',{class:'time-gutter-cell'}),days.map((key,i)=>{const d=D.fromDate(key);const dow=d.getDay();return h('button',{type:'button',class:'time-day'+(key===today?' is-today':'')+(key===selectedDate&&mode==='week'?' is-selected':'')+(dow===0||dow===6?' weekend':'')+(dow===0?' sunday':'')+(dow===6?' saturday':''),'data-day':key,'data-focus-key':'head-'+key,title:mode==='week'?tr('일간 보기'):koreanDate(key),onclick:()=>{if(mode==='week')setCalMode('day',key);}},h('span',{class:'time-weekday'},I.weekdays('short')[dow]),h('span',{class:'time-date',style:D.discInk(d.getDate())},d.getDate()));}));
  // The tasks by their titles (2026-11-11 owner, settings.calendarTasks): those with no time in the all-day row, the timed ones at their time in
  // the hours, bucketed once for the days drawn. The count way keeps its one line a day, as before.
  const titles=calTaskTitles();const taskDays=titles?D.taskBuckets(state.tasks,days):null;
  const tasksByDay=titles?null:days.map(key=>state.tasks.filter(t=>t.dueDate===key&&!t.completed).length+D.stepsDueOn(state.tasks,key).length);
  const untimed=titles?days.map(key=>taskDays.get(key).filter(t=>!D.dueAt(t))):null,clocked=titles?days.map(key=>taskDays.get(key).filter(t=>D.dueAt(t))):null;
  // Stepped to the next or the previous page: the headings, the all-day row and the columns slide in from that side (styles.css).
  const slide=calSlide;calSlide=0;
  return h('div',{class:'time-view '+mode+(slide>0?' slide-next':slide<0?' slide-prev':''),style:{'--days':days.length,'--hour':calHour+'px'},onwheel:calTimeWheel},h('div',{class:'time-scroll',onscroll:e=>{calScroll[mode]=e.currentTarget.scrollTop/calHour*60;}},h('div',{class:'time-sticky'},head,calAllDayRow(spans,days,tasksByDay,untimed)),calTimeBody(days,timed,minMinutes,today,clocked)));
}
function calAllDayRow(spans,days,tasksByDay,untimed=null){
  const {bars,lanes}=D.spanLayout(spans,days);const max=calAllDayOpen?lanes:Math.min(lanes,3);const shownBars=bars.filter(b=>b.lane<max);
  const hiddenPerDay=days.map((_,i)=>bars.filter(b=>b.lane>=max&&b.from<=i&&b.to>=i).length);
  const extraRow=hiddenPerDay.some(Boolean)?max+1:0,taskRow=Math.max(max,extraRow)+1;
  // untimed (2026-11-11): each day's tasks with no time as chips under that day's own bars (and its 「+n개」), while the day's lines stay within
  // CAL_ALLDAY_LINES, or within the lanes of an opened row; past that the day's tasks fold into its 「할 일 n」 line (calTasksFit as before), so
  // the row never pushes the hours down the window — opened included (2026-11-11 review: calAllDayOpen outlives the week it was opened in, and a
  // week of few bars has no toggle to close it, so thirty tasks of a day there grew the sticky row past the window). The fold line leads with a
  // ring, as the chips beside it. Without it (the count way) one line a day in the row's last place, as before.
  const used=days.map((_,i)=>hiddenPerDay[i]?extraRow:Math.max(0,...shownBars.filter(b=>b.from<=i&&b.to>=i).map(b=>b.lane+1)));
  const cap=Math.max(CAL_ALLDAY_LINES,max);const chips=untimed?untimed.map((list,i)=>used[i]+list.length<=cap?list:[]):null;
  const counts=untimed?untimed.map((list,i)=>chips[i].length?0:list.length):tasksByDay;const countRow=i=>untimed?used[i]+1:taskRow;
  const rows=Math.max(1,max,extraRow,...counts.map((n,i)=>n?countRow(i):0),...(chips||[]).map((list,i)=>list.length?used[i]+list.length:0));
  const toggle=lanes>3?ib(calAllDayOpen?'chevup':'chevdown',calAllDayOpen?tr('하루 종일 줄 접기'):tr('하루 종일 일정 모두 보기'),()=>{calAllDayOpen=!calAllDayOpen;render();},'allday-toggle'):null;
  const grid=h('div',{class:'allday-grid','data-allday':'1',ondblclick:e=>{if(performance.now()<calSuppressClick||e.target!==e.currentTarget)return;const day=calDayAtX(e.clientX);if(day)calCreateDraft({start:day,end:D.dayOffset(day,1),allDay:true});},onpointerdown:e=>{if(e.target===e.currentTarget)calPointerDown(e,{kind:'allday-create'});}},
    days.map((key,i)=>h('i',{class:'allday-cell'+([0,6].includes(D.fromDate(key).getDay())?' weekend':''),style:{gridColumn:String(i+1),gridRow:'1 / '+(rows+1)}})),
    shownBars.map(b=>calAllDayBar(b)),
    hiddenPerDay.map((n,i)=>n?h('button',{type:'button',class:'allday-more',style:{gridColumn:String(i+1),gridRow:String(extraRow)},onclick:()=>{calAllDayOpen=true;render();}},tr("+{0}개", [n])):null),
    (chips||[]).flatMap((list,i)=>list.map((t,k)=>calTaskChip(t,days[i],'allday',{gridColumn:String(i+1),gridRow:String(used[i]+k+1)}))),
    counts.map((n,i)=>n?h('button',{type:'button',class:'allday-tasks'+(untimed?' ringed':''),'aria-label':tr("할 일 {0}개", [n]),'data-short':tr("할 일 {0}", [n]),'data-min':String(n),style:{gridColumn:String(i+1),gridRow:String(countRow(i))},onclick:()=>calOpenPanelFor(days[i])},h('span',{class:'task-count'},tr("할 일 {0}개", [n]))):null),
    calDraft&&calDraft.allDay?calDraftBar(days):null);
  return h('div',{class:'time-allday'},h('div',{class:'time-gutter-cell allday-label'},toggle||h('span',{},tr('종일'))),grid);
}
// The week's 「할 일 n개」 lines (2026-11-02 r60 integration cal-rr-1): when one of them does not fit whole, all of them take the shorter
// 「할 일 12」 (English 「12」), and the number alone after the blue dot when that does not fit either (더 크게 in the smallest window) —
// 「할 일 1…」 read as one task in the default window with the panel docked. The full text stays the button's name. Measured after each
// render and resize of the grid (window, panel), as calTitleFit measures the title.
// A shrinking flex title holds its whole text, to the subpixel: its width as laid out against its width unshrunk. scrollWidth and clientWidth
// are whole pixels, and 「할 일 3개」 a fraction too wide passed as fitting and was drawn 「할 일 3…」 in the 900px week (2026-11-11 recheck pictures).
function calTextFits(t){const room=t.getBoundingClientRect().width;t.style.flex='none';const need=t.getBoundingClientRect().width;t.style.flex='';return need<=room+0.01;}
function calTasksFit(){/* the hours' task groups (calTaskCluster, 2026-11-11 recheck) one by one, after each render and resize: side by side while each title keeps CAL_TASK_ROOM px, else the one 「할 일 n개」 row — 「할 일 n」, then the number, in a narrower column; the keyboard goes along to what shows */const folded=[];for(const c of document.querySelectorAll('#app .time-col .time-cluster')){const b=c.lastElementChild,n=c.children.length-1,fold=calTaskRoom(c.clientWidth,n)<CAL_TASK_ROOM,a=document.activeElement;c.classList.toggle('folded',fold);if(fold&&a&&a!==b&&c.contains(a))b.focus({preventScroll:true});else if(!fold&&a===b)c.firstElementChild.focus({preventScroll:true});if(fold)folded.push(b.lastElementChild);}/* one form for every count the week shows, the all-day line's and the hours' alike — the longest that fits them all (2026-11-13 review: 「할 일 5개」 above 「할 일 3」 in one week) */const lines=[...document.querySelectorAll('#app .allday-grid .allday-tasks')];if(!lines.length&&!folded.length)return;const cs=lines.length?getComputedStyle(lines[0]):null,inset=cs?parseFloat(cs.paddingRight)+parseFloat(cs.borderRightWidth):0;const over=()=>lines.some(b=>b.firstElementChild.getBoundingClientRect().right>b.getBoundingClientRect().right-inset+0.01)||folded.some(t=>!calTextFits(t));const say=(b,t,form)=>{const text=form==='full'?b.getAttribute('aria-label'):b.dataset[form];if(t.textContent!==text)t.textContent=text;};for(const form of ['full','short','min']){for(const t of folded)say(t.parentNode,t,form);for(const b of lines)say(b,b.firstElementChild,form);if(!over())return;}}
function calAllDayBar(b){const bar=calAllDayNode(b);return calMode()==='day'?bar:calEdges(bar,b.event,'allday-stretch',{start:!b.before,end:!b.after});}
function calAllDayNode(b){const e=b.event;const editable=canEditEvent(e);const color=eventColor(e);const first=!b.before;return h('div',{class:'allday-bar'+(b.before?' cont-before':'')+(b.after?' cont-after':'')+(editable?'':' readonly')+(calPast(e)?' past':''),style:{gridColumn:(b.from+1)+' / '+(b.to+2),gridRow:String(b.lane+1),'--cal-color':color},role:'button',tabindex:0,'data-event-key':e.id,title:e.title+(e.allDay?'':' · '+timeLabel(e)),onclick:ev=>{ev.stopPropagation();if(performance.now()<calSuppressClick)return;showEvent(e,ev.currentTarget);},onkeydown:ev=>calEventKey(ev,e),oncontextmenu:ev=>{ev.preventDefault();ev.stopPropagation();eventMenu(e,ev.clientX,ev.clientY);},onpointerdown:ev=>calPointerDown(ev,{kind:'allday',event:e})},!e.allDay&&first?h('span',{class:'chip-time'},fmtTime(e.start,true)+' ~'):null,h('span',{class:'chip-title'},e.title),isRecurring(e)?h('span',{class:'chip-repeat',title:tr('반복')},icon('repeat',12)):null);}
function calDraftBar(days){const s=calDraft.start,last=D.dayOffset(calDraft.end,-1);if(s>days[days.length-1]||last<days[0])return null;const from=days.indexOf(s<days[0]?days[0]:s),to=days.indexOf(last>days[days.length-1]?days[days.length-1]:last);if(to<0)return null;return h('div',{class:'allday-bar draft','data-event-key':'draft',style:{gridColumn:(from+1)+' / '+(to+2),gridRow:'1'}},h('span',{class:'chip-title'},calCard?.title||tr('새 일정')));}
// Timed tasks whose rows would run into each other, as one group (2026-11-11 recheck: grouped by the minute, 9:00, 9:10 and 9:20 beside a 9:00
// meeting still split an 80px week column four ways; D.defaultDueTime gives new tasks the next whole hour, so a shared hour is common): a task
// within minMinutes — the height dayLayout gives a row — of the one before joins its group, which the hours lay out as one item from its first
// time to its last row. A task alone keeps an item of its own.
function calClockItems(list,minMinutes){const groups=[];let group=null,last=0;for(const t of [...list].sort((a,b)=>D.dueAt(a)-D.dueAt(b))){const at=D.dueAt(t).getTime();if(group&&at<last+minMinutes*60000)group.push(t);else{group=[t];groups.push(group);}last=at;}return groups.map(g=>{const first=D.dueAt(g[0]).getTime();return g.length>1?{id:'tasks:'+first,start:new Date(first).toISOString(),end:new Date(D.dueAt(g.at(-1)).getTime()+minMinutes*60000).toISOString(),tasks:g}:{id:'task:'+g[0].id+(g[0].stepTime?'~'+g[0].stepTime:''),start:new Date(first).toISOString(),task:g[0]};});}
// A group in the hours: each task its row at its own time, side by side in the group's place while every title keeps CAL_TASK_ROOM px; in less —
// a week column at 1180 — calTasksFit folds the group into its one 「할 일 n개」 row at the first time, which opens the day in the panel, where they
// are listed, and whose tooltip says each time and title (2026-11-11 recheck: by the room, not the count — the day view's 510px column has room
// for two titles side by side, as before the fold). The place's --reach is the hours from the first row to the last.
function calTaskCluster(list,day,place){const n=list.length,first=D.dueAt(list[0]).getTime(),dy=t=>(D.dueAt(t).getTime()-first)/3600000;return h('div',{class:'time-cluster',style:{...place,'--reach':dy(list.at(-1))}},list.map((t,k)=>calTaskChip(t,day,'time',{'--k':k,'--n':n,'--dy':dy(t)})),
  h('button',{type:'button',class:'time-task time-tasks','data-focus-key':'tasks-'+day+'@'+list[0].dueTime,'aria-label':tr("할 일 {0}개", [n]),'data-short':tr("할 일 {0}", [n]),'data-min':String(n),title:list.map(t=>fmtTime(D.dueAt(t))+' '+(t.stepTime?(t.stepsDue||[]).map(x=>x.title).join(', ')+' ('+t.title+')':t.title)).join(', ')/* a subtask's time names the subtask (2026-11-11 review) */,onclick:ev=>{ev.stopPropagation();if(performance.now()<calSuppressClick)return;calOpenPanelFor(day);},ondblclick:ev=>ev.stopPropagation()},h('i',{class:'task-ring','aria-hidden':'true'}),h('span',{class:'chip-title'},tr("할 일 {0}개", [n]))));}
function calTimeBody(days,timed,minMinutes,today,clocked=null){
  const gutter=h('div',{class:'time-gutter'},Array.from({length:23},(_,i)=>h('span',{class:'hour-label',style:{'--at':i+1}},calHourLabel(i+1))),days.includes(today)?h('span',{class:'now-pill'},calClock(new Date())):null);
  const cols=h('div',{class:'time-cols'},days.map((key,i)=>{const dow=D.fromDate(key).getDay();/* a timed task (2026-11-11) is laid out with the events as an item one line tall at its time — never a duration block —, so an event over it shares the width with it as two events do */const items=D.dayLayout([...eventsOn(key,timed),...(clocked?calClockItems(clocked[i],minMinutes):[])],key,minMinutes);return h('div',{class:'time-col'+(dow===0||dow===6?' weekend':'')+(key===today?' is-today':''),'data-day':key,onpointerdown:e=>{if(e.target===e.currentTarget)calPointerDown(e,{kind:'create',day:key});},onclick:e=>{if(e.target!==e.currentTarget||performance.now()<calSuppressClick||e.detail>=2)return;if(selectedDate!==key){selectedDate=key;calSyncMonth();render();}},ondblclick:e=>{if(e.target!==e.currentTarget||performance.now()<calSuppressClick)return;const start=D.atWall(key,Math.floor(calMinutesAt(e.clientY,e.currentTarget)/CAL_STEP)*CAL_STEP);calCreateDraft({start:start.toISOString(),end:new Date(start.getTime()+3600000).toISOString(),allDay:false});}},items.map(item=>{const place={'--top':item.top/60,'--col':item.col,'--span':item.span||1,'--cols':item.cols};return item.event.tasks?calTaskCluster(item.event.tasks,key,place):item.event.task?calTaskChip(item.event.task,key,'time',place):calTimeBlock(item,key);}),calDraft&&!calDraft.allDay?calDraftBlock(key,minMinutes):null,key===today?h('div',{class:'now-line'}):null);}),days.length>1&&days.includes(today)?h('div',{class:'now-dim'}):null);
  return h('div',{class:'time-body'},gutter,cols);
}
function calTimeBlock(item,day){
  const e=item.event;const editable=canEditEvent(e);const startsHere=D.localKey(e.start)===day,endsHere=D.dateKey(new Date(new Date(e.end||e.start).getTime()-1))===day||new Date(e.end||e.start).getTime()===new Date(e.start).getTime();
  // 16px text rows in the block (height px−2, padding 2+2): two rows are a one-line title and the time, three a two-line title and
  // the time, or title, time and place — the title's second line ran over the time below 54px an hour (2026-11-02 review app-design-2).
  const px=(item.bottom-item.top)/60*calHour;const rows=Math.floor((px-6)/16);const lines=rows<2?1:rows<3?2:3;/* the title takes the rows it needs (2026-11-08 owner: 자리가 있는데 …로 줄이지 말고); the time and the place follow while whole lines are left, styles.css */const titleRows=lines===1?1:rows;const time=startsHere?timeLabel(e):tr('{0}까지',[fmtTime(e.end)]);
  // The time in three lengths, the block's width picks one (container query): 「오전 10:00–오전 11:00」, 「오전 10:00」, 「10:00」 — a 75px
  // column showed 「오전 10:…」 on every block (2026-11-02 review usability-4; Apple shows the start alone when narrow).
  // A one-line block shares its row with the title, so it drops to 「10:00」 as soon as the range would not fit; a block that only
  // ends here (「오전 11:00까지」) drops 오전/오후 first (「11:00까지」), then 「까지」 for a dash (「–11:00」: 「10:00까…」 and 「until 1:…」
  // were cut in a 48px column, 2026-11-02 recheck of usability-4).
  const at=startsHere?e.start:e.end;const clock=calClock(new Date(at));const bare=startsHere?clock:'–'+clock;
  const node=h('div',{class:'time-event'+(editable?'':' readonly')+(calPast(e)?' past':'')+(lines===1?' one-line':''),role:'button',tabindex:0,'data-event-key':e.id,/* render() puts the keyboard back on it (the hour-height redraw after a height-only resize dropped it to <body>, 2026-11-02 r60 carry-over F-2) */'data-focus-key':'ev-'+e.id+'@'+day,style:{'--top':item.top/60,'--len':(item.bottom-item.top)/60,'--col':item.col,'--span':item.span||1,'--cols':item.cols,'--cal-color':eventColor(e),'--title-rows':titleRows},title:e.title+' · '+timeLabel(e),
    onclick:ev=>{ev.stopPropagation();if(performance.now()<calSuppressClick)return;showEvent(e,ev.currentTarget);},onkeydown:ev=>calEventKey(ev,e),oncontextmenu:ev=>{ev.preventDefault();ev.stopPropagation();eventMenu(e,ev.clientX,ev.clientY);},onpointerdown:ev=>calPointerDown(ev,{kind:'move',event:e,day})},
    // the name in its own box: a one-line block shows the time only when it fits whole beside the name, never 「30분 통화 · …」 (styles.css r60-int, 2026-11-02 r60 integration cal-2)
    h('span',{class:'time-event-title'},h('span',{class:'time-event-name'},e.title||tr('제목 없는 일정'),startsHere?null:h('span',{class:'cont'},' '+tr('(계속)'))),isRecurring(e)?h('span',{class:'chip-repeat',title:tr('반복')},icon('repeat',12)):null,lines===1?h('span',{class:'time-event-inline'},h('span',{class:'t-full'},fmtTime(at)),h('span',{class:'t-bare'},clock)):null),
    lines>1?h('span',{class:'time-event-time'},h('span',{class:'t-full'},time),h('span',{class:'t-start'},startsHere?fmtTime(at):tr('{0}까지',[clock])),h('span',{class:'t-bare'},bare)):null,lines>2&&e.location?h('span',{class:'time-event-place'},e.location):null);
  if(editable&&startsHere&&px>=28)node.append(h('i',{class:'resize-handle top','aria-hidden':'true',onpointerdown:ev=>calPointerDown(ev,{kind:'resize-start',event:e,day})}));
  if(editable&&endsHere)node.append(h('i',{class:'resize-handle bottom','aria-hidden':'true',onpointerdown:ev=>calPointerDown(ev,{kind:'resize-end',event:e,day})}));
  return node;
}
function calDraftBlock(day,minMinutes){const s=new Date(calDraft.start),e=new Date(calDraft.end);const items=D.dayLayout([{id:'draft',start:calDraft.start,end:calDraft.end}].filter(x=>D.inDay(x,day)),day,minMinutes);if(!items.length)return null;const it=items[0];return h('div',{class:'time-event draft','data-event-key':'draft',style:{'--top':it.top/60,'--len':(it.bottom-it.top)/60,'--col':0,'--span':1,'--cols':1}},h('span',{class:'time-event-title'},calCard?.title||tr('새 일정')),h('span',{class:'time-event-time'},fmtTime(s)+D.RANGE+fmtTime(e)));}
function calEventKey(ev,e){if(ev.key==='Enter'||ev.key===' '){ev.preventDefault();ev.stopPropagation();showEvent(e,ev.currentTarget);}else if((ev.key==='Delete'||ev.key==='Backspace')&&canEditEvent(e)){ev.preventDefault();ev.stopPropagation();deleteEventFlow(e);}}
const calMinutesAt=(y,col)=>Math.max(0,Math.min(1440,(y-col.getBoundingClientRect().top)/calHour*60));
function calDayAtX(x){const cells=[...document.querySelectorAll('.time-head .time-day')];if(!cells.length)return null;let best=cells[0];for(const c of cells){const r=c.getBoundingClientRect();if(x>=r.left)best=c;}return best.dataset.day;}
function calColumnAt(x){const cols=[...document.querySelectorAll('.time-col')];if(!cols.length)return null;let best=cols[0];for(const c of cols){if(x>=c.getBoundingClientRect().left)best=c;}return best;}

// ---- Pointer gestures: a click opens the card; a real drag (4px) moves, stretches or draws (Notion, Apple) ----
// While a time grid gesture runs, renders wait (calHolding) so the dragged block is not rebuilt under the pointer.
const calHolding=()=>calPanelDragging||Boolean(calGesture&&calGesture.started&&!calGesture.committing&&!calGesture.kind.startsWith('month'));
let calKeyboardOpen=false;
function calPointerDown(ev,spec){
  if(ev.button!==0||isWidget||calGesture||ev.cardClosed||calCard?.closing||$('#modal-root .dialog'))return;
  closeMenu();
  /* a press on an empty day is still that: its click, and the mousedown that closes what is open (datePop) */if(spec.kind!=='month-draw'){ev.stopPropagation();if(ev.pointerType==='mouse')ev.preventDefault();}
  calKeyboardOpen=false;
  /* the piece pressed: an event over two weeks has one in each (Argon recheck GN4) */calGesture={...spec,node:ev.currentTarget,x0:ev.clientX,y0:ev.clientY,x:ev.clientX,y:ev.clientY,t0:performance.now(),pointerId:ev.pointerId,pointerType:ev.pointerType,started:false};
  window.addEventListener('pointermove',calPointerMove,true);window.addEventListener('pointerup',calPointerUp,true);window.addEventListener('pointercancel',calPointerCancel,true);
}
function calPointerMove(ev){const g=calGesture;if(!g||ev.pointerId!==g.pointerId)return;g.x=ev.clientX;g.y=ev.clientY;if(!g.started){if(Math.hypot(g.x-g.x0,g.y-g.y0)<4)return;if(g.pointerType==='touch'&&performance.now()-g.t0<500){calEndGesture();return;}calStartGesture();}ev.preventDefault();calUpdateGesture();}
function calPointerUp(ev){const g=calGesture;if(!g||ev.pointerId!==g.pointerId)return;if(!g.started){calEndGesture();return;}ev.preventDefault();calSuppressClick=performance.now()+350;g.x=ev.clientX;g.y=ev.clientY;calUpdateGesture();calFinishGesture();}
function calPointerCancel(ev){if(calGesture&&ev.pointerId===calGesture.pointerId)calCancelGesture();}
function calStartGesture(){
  const g=calGesture;g.started=true;if(!closeCard(true)){calEndGesture();return;}g.days=calDays();
  const e=g.event;g.denied=Boolean(e)&&!canEditEvent(e);
  document.body.classList.add('cal-dragging');if(g.denied)document.body.classList.add('cal-denied');if(g.kind==='resize-start'||g.kind==='resize-end')document.body.classList.add('cal-resizing');if(g.kind.endsWith('-stretch'))document.body.classList.add('cal-stretching');
  if(e&&!g.denied)for(const n of document.querySelectorAll('#app [data-event-key="'+CSS.escape(e.id)+'"]'))n.classList.add('drag-source');
  if(g.kind==='move'){const col=calColumnFor(g.day);const pointer=D.atWall(g.day,calMinutesAt(g.y0,col)).getTime();g.grab=pointer-new Date(e.start).getTime();g.length=Math.max(0,new Date(e.end||e.start)-new Date(e.start));}
  if(g.kind==='create'){const col=calColumnFor(g.day);g.anchor=D.atWall(g.day,Math.floor(calMinutesAt(g.y0,col)/CAL_STEP)*CAL_STEP);}
  if(g.kind==='allday'||g.kind==='allday-create')g.grabDay=calDayAtX(g.x0);
  if(g.kind==='month-stretch'&&!g.denied)g.lane=Number(g.node?.closest?.('.month-bar')?.style.getPropertyValue('--lane'))||0;
  if((g.kind==='month-stretch'||g.kind==='month-draw')&&!g.denied)g.edge=setInterval(calMonthEdge,400);
  if(g.kind==='month'&&!g.denied){const source=g.node?.closest?.('.day-event');g.ghost=h('div',{class:'drag-chip'},source?source.cloneNode(true):e.title);document.body.append(g.ghost);g.edge=setInterval(calMonthEdge,400);}
  if(!g.kind.startsWith('month')&&!g.kind.startsWith('allday'))g.frame=requestAnimationFrame(calAutoScroll);
}
function calUpdateGesture(){
  const g=calGesture;if(!g||!g.started)return;const e=g.event;
  if(g.kind==='month'){if(g.ghost){g.ghost.style.left=g.x+'px';g.ghost.style.top=g.y+'px';}const cell=calCellAt(g.x,g.y);for(const n of document.querySelectorAll('.calendar-day.drop-target'))if(n!==cell)n.classList.remove('drop-target');if(g.denied)return;if(cell)cell.classList.add('drop-target');g.result=cell?calShiftTo(e,g.day,cell.dataset.day):null;return;}
  // One end dragged, or a range drawn: the days under the pointer, over the weeks in the order of the days, so Friday to Wednesday goes on from the row's end to the next row's start.
  if(g.kind==='month-stretch'||g.kind==='month-draw'){const day=calCellAt(g.x,g.y)?.dataset.day||g.last;if(!day||g.denied)return;g.last=day;if(g.kind==='month-draw'){const a=g.day<day?g.day:day,b=g.day<day?day:g.day;g.result=a===b?null:{start:a,end:D.dayOffset(b,1),allDay:true};calMonthGhost(g.result?a:'',b,tr('새 일정'),null);return;}g.result=D.stretchedEvent(e,g.side,day);const r={...e,...g.result};calMonthGhost(D.localKey(r.start),calLastDay(r),e.title,eventColor(e),g.lane);return;}
  if(g.kind==='allday-stretch'){const day=calDayAtX(g.x);if(!day||g.denied)return;g.result=D.stretchedEvent(e,g.side,day);const r={...e,...g.result};calAllDayGhost(D.localKey(r.start),calLastDay(r),e.title,eventColor(e));return;}
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
  if(g.kind==='create'||g.kind==='allday-create'||g.kind==='month-draw'){calEndGesture();if(result)calCreateDraft(result);else if(g.kind==='month-draw'){/* stayed in its day: the click its move took away */selectedDate=g.day;render();}return;}
  const same=(a,b)=>a===b||(String(a).length>10&&Date.parse(a)===Date.parse(b));
  if(!result||(same(result.start,e.start)&&same(result.end,e.end))){calEndGesture();return;}
  const kind=g.kind.endsWith('-stretch')?'stretch':g.kind.startsWith('resize')?'resize':'move';
  calStopGestureInput();g.committing=true;
  calCommitChange(e,result,kind).finally(()=>{if(calGesture===g)calEndGesture();});
}
function calCancelGesture(){calEndGesture();}
function calStopGestureInput(){window.removeEventListener('pointermove',calPointerMove,true);window.removeEventListener('pointerup',calPointerUp,true);window.removeEventListener('pointercancel',calPointerCancel,true);const g=calGesture;if(g){cancelAnimationFrame(g.frame);clearInterval(g.edge);g.ghost?.remove();}document.body.classList.remove('cal-dragging','cal-denied','cal-resizing','cal-stretching');for(const n of document.querySelectorAll('.drop-target'))n.classList.remove('drop-target');}
function calEndGesture(){calStopGestureInput();calGesture=null;for(const n of document.querySelectorAll('.time-event.ghost,.allday-bar.ghost,.month-bar.ghost'))n.remove();for(const n of document.querySelectorAll('.drag-source'))n.classList.remove('drag-source');if(renderPending){renderPending=false;render();}}
// Ghost blocks for the dragged or drawn range, one per visible day it touches.
function calGhost(start,end,label,draft){for(const n of document.querySelectorAll('.time-event.ghost'))n.remove();const e=calGesture?.event;for(const col of document.querySelectorAll('.time-col')){const day=col.dataset.day;const piece={id:'ghost',start:start.toISOString(),end:end.toISOString()};if(!D.inDay(piece,day))continue;const it=D.dayLayout([piece],day,Math.ceil(22/calHour*60))[0];if(!it)continue;col.append(h('div',{class:'time-event ghost'+(draft?' draft':''),style:{'--top':it.top/60,'--len':(it.bottom-it.top)/60,'--col':0,'--span':1,'--cols':1,'--cal-color':e?eventColor(e):null}},h('span',{class:'time-event-title'},e?e.title:tr('새 일정')),h('span',{class:'time-event-time'},label)));}}
function calAllDayGhost(from,to,title,color){for(const n of document.querySelectorAll('.allday-bar.ghost'))n.remove();const grid=document.querySelector('.allday-grid');if(!grid)return;const days=calGesture?.days||calDays();const a=from<days[0]?days[0]:from,b=to>days[days.length-1]?days[days.length-1]:to;const i=days.indexOf(a),j=days.indexOf(b);if(i<0||j<0||j<i)return;grid.append(h('div',{class:'allday-bar ghost'+(color?'':' draft'),style:{gridColumn:(i+1)+' / '+(j+2),gridRow:'1','--cal-color':color}},h('span',{class:'chip-title'},title)));}
function calRangeLabel(start,end,withLength){const text=fmtTime(start)+D.RANGE+fmtTime(end);return withLength?text+' ('+calDuration(Math.round((end-start)/60000))+')':text;}
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
function calAskScope(title,labels){return new Promise(resolve=>{let done=false;const finish=v=>{if(done)return;done=true;resolve(v);};modal(title,h('div',{class:'dialog-body'},h('div',{class:'scope-options'},[['one',labels.one],['future',labels.future],['all',labels.all]].filter(([,l])=>l).map(([s,l])=>btn(l,()=>{finish(s);closeModal();},'button subtle wide'+(s==='one'?' primary-choice':'')))),h('div',{class:'dialog-footer'},btn(tr('취소'),()=>{finish(null);closeModal();},'button subtle'))),false,{stack:true,noClose:true,compact:true,onDismiss:()=>finish(null)}/* 이 일정만/이후/모두 with its own 취소: no X, like the delete chooser; Esc and the outside click still settle null (2026-11-02 r60 integration) */);});}
const calSeries=e=>Boolean(e&&((e.rrule&&e.masterId)||(!isLocalEvent(e)&&e.recurring)));
function calScopeLabels(e,change){const provider=!isLocalEvent(e);const dayChanged=('start' in change)&&D.localKey(change.start)!==D.localKey(e.start);const flip=('allDay' in change)&&Boolean(change.allDay)!==Boolean(e.allDay);const ruleChanged='rrule' in change;const c=D.scopeChoices(e,{provider,dayChanged,flip,ruleChanged});return {one:c.one?tr('이 일정만'):null,future:c.future?tr('이후 모든 일정'):null,all:c.all?tr('모든 일정'):null};}
async function calCommitChange(e,change,kind){
  const before={start:e.start,end:e.end};let scope=null;
  if(calSeries(e)){scope=await calAskScope(tr('「{0}」 반복 일정을 어떻게 바꿀까요?',[shortTitle(e.title)||tr('제목 없는 일정')]),calScopeLabels(e,change));if(!scope)return;}
  let result;try{result=await run('event:update',{id:e.id,...(scope?{scope}:{}),...change});}catch{return;}
  const occurrence=Boolean(e.rrule&&e.masterId);
  const undoId=scope==='all'&&occurrence?e.masterId+'@'+(e.allDay?change.start:new Date(change.start).toISOString()):(result?.id||e.id);
  const canUndo=!scope||scope==='one'||(scope==='all'&&occurrence);
  const text=kind==='stretch'?tr('일정 기간을 바꿨어요.'):kind==='resize'?tr('일정 시간을 바꿨어요.'):tr('일정을 옮겼어요.');
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
  /* no time chosen, no time made up (2026-11-07 owner: 「시간을 따로 지정 안 하면 하루 종일로 되어 있는 게 더 편하지 않을까」, 「오전 9시 저건 왜」): a time typed in the line or 하루 종일 switched off gives it one; a place pressed on the time grid has its own (calCreateDraft's other callers) */const draft={start:day,end:D.dayOffset(day,1),allDay:true};
  if(view==='calendar'&&calMode()!=='month'){if(!calDays().includes(day)){selectedDate=day;calSyncMonth();}calCreateDraft(draft);return true;}
  let target=anchor||(view==='calendar'?document.querySelector('#app .calendar-day[data-day="'+day+'"]'):null);
  if(!target&&view==='calendar'){selectedDate=day;calSyncMonth();render();target=document.querySelector('#app .calendar-day[data-day="'+day+'"]');}
  if(!target)return false;
  if(!closeCard(true))return true;calOpenCard({mode:'create',draft},target.getBoundingClientRect());return true;
}
function calCreateDraft(draft){if(!closeCard(true))return;calDraft={...draft};render();const anchor=document.querySelector('#app [data-event-key="draft"]');anchor?.scrollIntoView?.({block:'nearest'});calOpenCard({mode:'create',draft},anchor?anchor.getBoundingClientRect():null);}

// ---- The event card (Notion's floating event panel): opens beside the event, saves as you go ----
const calDockPanel=()=>document.querySelector('#app .calendar-view>.day-panel:not(.drawer)');
// A card in the day panel gives the panel back to the day when it closes (2026-11-05); a floating one leaves its root.
function calCardUnmount(c){if(c?.docked&&c.node){const panel=c.node.closest('.day-panel');c.node.remove();if(panel?.isConnected)panel.replaceWith(dayPanel(false,false));return;}calCardRoot().replaceChildren();}
function calCardRoot(){let root=document.getElementById('card-root');if(!root){root=h('div',{id:'card-root'});document.body.append(root);}return root;}
function calValuesOf(src){const allDay=Boolean(src.allDay);const startKey=String(src.start).slice(0,10);return {title:src.title||'',allDay,start:allDay?startKey:toLocalInput(src.start),end:allDay?D.dayOffset(String(src.end||D.dayOffset(startKey,1)).slice(0,10),-1):toLocalInput(src.end||src.start),location:src.location||'',notes:src.notes||'',color:src.color||null,rrule:src.rrule||'',alert:src.alert===undefined?undefined:src.alert};}
const calTimes=v=>({start:v.allDay?v.start:new Date(v.start).toISOString(),end:v.allDay?D.dayOffset(v.end,1):new Date(v.end).toISOString(),allDay:v.allDay});
// Clicking an event (any view, the right panel, the tasks screen) opens its card; a read-only event shows the same card as text.
// A saved event clicked on the calendar screen opens its card in the day panel while that panel is docked (2026-11-05 owner: 「달력에서도 …
// 저장된 특정 일정을 클릭했을 때 … 우측탭에 세부 항목을 편집하거나 볼 수 있게」, Notion Calendar's side panel): the same card, its saving, scope
// question and read-only rules; Esc or 닫기 gives the day back. A new event, the tasks screen's panel and a narrow window (the drawer) keep the
// floating card. dock: the 「+n개」 list's rows, which sit in their own floating list.
function openEventCard(e,anchor,rect,{dock=false}={}){if(isWidget)return false;closeMenu();if(calCard&&calCard.key===e.id&&calCard.node){calCard.node.focus({preventScroll:true});return true;}if(!closeCard(true))return true;const region=anchor?.closest?.(calAnchorRegions);const docked=view==='calendar'&&calPanelDocked()&&(dock||Boolean(anchor?.closest?.('#app .calendar-view')));calOpenCard({mode:canEditEvent(e)?'edit':'view',event:e},rect||(anchor?anchor.getBoundingClientRect():null),docked);if(calCard&&region)calCard.region='.'+region.classList[0];/* the piece it opened from: an event over two weeks has one in each */if(calCard)calCard.piece=anchor?.dataset?.focusKey||null;return true;}
function calOpenCard({mode,event,draft},rect,docked=false){
  const v=calValuesOf(mode==='create'?{...draft,title:''}:event);
  const calendars=writableCalendars();const preferred=D.defaultCalendarId(state);
  /* draftOpen: the board as the card opened — a month day has no draft — given back with the card's first values (calLineDraw, 2026-11-11 review) */calCard={mode,event:event||null,draftOpen:mode==='create'&&calDraft?{...calDraft}:null,key:mode==='create'?'draft':event.id,v,original:{...v},pending:{},timer:null,series:mode==='edit'&&calSeries(event),calendarId:mode==='create'?(calendars.find(c=>c.id===preferred)||calendars[0])?.id:event.calendarId,swatches:false,title:'',rect,node:null,docked:Boolean(docked)&&mode!=='create'};
  calRenderCard();calPlaceCard(rect);
  const title=calCard.node.querySelector('.card-title');
  if(mode==='create'||calKeyboardOpen)title?.focus({preventScroll:true});else calCard.node.focus({preventScroll:true});
  calMarkAnchor();
}
function calRenderCard(){
  const c=calCard;if(!c)return;const active=document.activeElement;const focusKey=c.node&&c.node.contains(active)?active.closest('[data-card-focus]')?.getAttribute('data-card-focus')||null:null;/* a choice made in the open menu: its option has focus (area H) */
  /* in the day panel while it is there, else floating as before (2026-11-05) */if(c.docked&&!c.node?.isConnected&&!calDockPanel())c.docked=false;
  const node=calCardNode();if(c.node&&c.node.isConnected){/* the card is already up: the new node takes its place without the pop-in, which read as the card going away and coming back (2026-11-07 owner: 「화면이 꺼졌다가 다시 켜지는거도 이상하고」) */node.style.animation='none';c.node.replaceWith(node);}else if(c.docked){const panel=calDockPanel();panel.classList.add('card-docked');panel.replaceChildren(node);}else calCardRoot().replaceChildren(node);
  if(c.node){node.style.left=c.node.style.left;node.style.top=c.node.style.top;}c.node=node;
  if(focusKey)node.querySelector('[data-card-focus="'+focusKey+'"]')?.focus({preventScroll:true});
  const title=node.querySelector('textarea.card-title');if(title)calGrow(title);const notes=node.querySelector('textarea.card-notes-input');if(notes)calGrowNotes(notes);
}
// Enter in a card field: with the Korean IME the Enter that ends a syllable arrives while composing (and Windows sends no second
// Enter), so it acts right after the composition ends — one Enter saves, as it does for English text.
function calEnter(action){let pending=false;return {onkeydown:ev=>{if(ev.key!=='Enter'||ev.shiftKey)return;if(ev.isComposing||ev.keyCode===229){pending=true;return;}ev.preventDefault();pending=false;action(ev.target);},oncompositionend:ev=>{if(!pending)return;const target=ev.target;setTimeout(()=>{if(!pending)return;pending=false;action(target);},30);}};}
const calGrow=t=>{t.style.height='auto';const cap=4*24+8;/* four lines, then it scrolls (2026-11-09, tests/title-wrap-1109) */t.style.height=Math.min(t.scrollHeight,cap)+'px';t.style.overflowY=t.scrollHeight>cap?'auto':'hidden';};
// Notes (2026-11-05 owner 「달력에서 메모 기능도 있는 게 좋지 않을까?」 → 「달력 메모 이거도 구현해줘」): under 장소, a box that grows with
// its lines (ten, then it scrolls) and saves as 장소 does — on leaving it, the card's changes going out 0.4 s later (a repeating event's
// at the close, with the scope question); a new event's go with the rest. A note its service keeps with formatting (`notesRich`: links,
// bold — lib/providers/common.cjs) shows its words and changes only after 「텍스트로 고치기」, which says the formatting goes (main
// notesEditable); a read-only or older event shows its notes as text. A connected event stored before notes came shows none until a
// sync brings its note. One shown cut at 20,000 characters (`notesCut`) stays text, even after 「텍스트로 고치기」 (2026-11-05 check: a
// save kept only the part shown), and this PC's events have no marks to heed (an archive's included — lib/store.cjs).
const calGrowNotes=t=>{t.style.height='auto';t.style.height=Math.min(t.scrollHeight,10*20+8)+'px';};
function calNotesRow(view){
  const c=calCard,v=c.v,e=c.event;const text=n=>h('p',{class:'card-notes-text'},n);const row=(...kids)=>h('div',{class:'card-row card-notes'},icon('note',16),...kids);
  if(view||(c.mode==='edit'&&!isLocalEvent(e)&&typeof e.notes!=='string'))return e?.notes?row(text(e.notes)):null;
  const remote=c.mode==='edit'&&!isLocalEvent(e);
  if(remote&&e.notesCut)return row(h('div',{class:'card-notes-body'},v.notes?text(v.notes):null,h('p',{class:'card-note'},tr('메모가 길어 앞부분만 보여요. 원래 달력 앱에서 고쳐 주세요.'))));
  if(remote&&e.notesRich&&!c.notesPlain)return row(h('div',{class:'card-notes-body'},v.notes?text(v.notes):null,h('p',{class:'card-note'},tr('서식이 있는 메모예요.'),' ',h('button',{type:'button',class:'card-notes-plain','data-card-focus':'notes-plain',onclick:()=>{if(calCard!==c)return;c.notesPlain=true;calRenderCard();c.node?.querySelector('textarea.card-notes-input')?.focus({preventScroll:true});}},tr('텍스트로 고치기')))));
  const box=h('textarea',{class:'card-input card-notes-input',rows:1,maxlength:20000,placeholder:tr('메모 추가'),'aria-label':tr('메모'),'data-card-focus':'notes',value:v.notes||'',
    oninput:ev=>{v.notes=ev.target.value;calGrowNotes(ev.target);const b=c.node?.getBoundingClientRect?.();if(b&&b.bottom>innerHeight-12)calPlaceCard();},
    onblur:()=>{if(c.mode==='edit'&&(v.notes||'')!==c.original.notes){c.original.notes=v.notes||'';calCardChange({notes:v.notes||'',...(c.notesPlain?{notesPlain:true}:{})});}}});
  return row(c.notesPlain&&e?.notesRich?h('div',{class:'card-notes-body'},box,h('p',{class:'card-note'},tr('고치면 서식은 사라지고 글자만 남아요.'))):box);
}
function calCardNode(){
  const c=calCard,v=c.v,e=c.event,view=c.mode==='view';
  const cal=c.mode==='create'?state.calendars.find(x=>x.id===c.calendarId):calendarOf(e);const base=calendarColor(cal);const color=v.color||base;
  // An event older than the recent window keeps its colour as it is (lib/calhistory.cjs): a dot, not a button.
  /* the dot stands on the title's first line, the head row keeps ⋯ and × (2026-11-09 smoke V27: alone at the head's left it read as a stray mark) */const dot=e?.history?h('span',{class:'card-color static',style:{'--dot':color},'aria-hidden':'true'}):h('button',{type:'button',class:'card-color',style:{'--dot':color},'aria-label':tr('이 일정의 색'),title:tr('이 일정의 색'),'aria-expanded':c.swatches,'data-card-focus':'color',onclick:()=>{c.swatches=!c.swatches;calRenderCard();}});const head=h('header',{class:'card-head'},h('span',{class:'card-spacer'}),c.mode==='create'?null:ib('more',tr('일정 옵션'),ev=>calCardMenu(ev.currentTarget)),ib('close',c.mode==='create'?tr('취소'):tr('닫기'),()=>closeCard(c.mode!=='create')));
  const title=view?h('h2',{class:'card-title static'},e.title||tr('제목 없는 일정')):h('textarea',{class:'card-title',rows:1,maxlength:500,placeholder:c.mode==='create'?tr('새 일정'):tr('일정 제목'),'aria-label':tr('일정 제목'),'data-card-focus':'title',value:v.title,
    oninput:ev=>{const t=ev.target;if(t.value.includes('\n'))t.value=t.value.replace(/\n+/g,' ');v.title=t.value;c.title=t.value.trim();calGrow(t);/* a fourth line can push the card past the window's bottom: back in, as the notes box (tests/title-paste-1109) */const b=c.node?.getBoundingClientRect?.();if(b&&b.bottom>innerHeight-12)calPlaceCard();for(const n of document.querySelectorAll('#app [data-event-key="draft"] .time-event-title,#app [data-event-key="draft"] .chip-title'))n.textContent=c.title||tr('새 일정');},
    ...calEnter(target=>{if(c.mode==='create')calSaveNew(true);else target.blur();}),
    onblur:()=>{if(c.mode!=='edit')return;const text=v.title.trim();if(!text){v.title=c.original.title;calRenderCard();return;}if(text!==c.original.title){c.original.title=text;calCardChange({title:text});}}});/* Shift+Enter puts nothing in, as in the other title fields; a pasted line break goes in as a space (app.js oneLinePaste) */if(!view){oneLinePaste(title);title.addEventListener('keydown',ev=>{if(ev.key==='Enter'&&ev.shiftKey&&!ev.isComposing&&ev.keyCode!==229)ev.preventDefault();});}
  /* what the typed line is understood as, dim, under the title of a new event (Notion Calendar shows it the same way) */const hint=c.mode==='create'&&!view?h('p',{class:'card-hint','aria-live':'polite'}):null;if(hint){const show=()=>{const text=calHintText(c),s=calReadTitle(c)?.shortcut;/* 그대로: a word meant as itself this once (「점심 메뉴 회의」), said where the change shows; the keyboard stays in the title */hint.replaceChildren(...(s?[h('span',{},text),h('button',{type:'button',class:'text-button card-hint-keep',title:tr('이번 일정만 적은 그대로 저장해요.'),onmousedown:ev=>ev.preventDefault(),onclick:ev=>{const had=document.activeElement===ev.currentTarget;c.shortcutOff=D.shortcutKey(s.word);calFollowLine(c);show();/* pressed from the keyboard: the button goes with its word, the keyboard to the end of the title (2026-11-13 review: it fell to the page) */if(had&&title.isConnected){title.focus({preventScroll:true});const n=title.value.length;try{title.setSelectionRange(n,n);}catch{}}}},tr('그대로'))]:text?[text]:[]));};/* the form follows the line as it is typed (calFollowLine, 2026-11-11); a letter the IME has not made a syllable yet waits, and the end of the composition reads what it became. With the Korean IME a syllable being made, or one just ended that the next may build on, is read after a quarter second without keys: 하루 종일 does not flick off and on for 「점심」 on the way to 「점심약속」 (2026-11-11 review). A space, Backspace and other typing read at once, and 저장 reads the line itself (calSaveNew) */let idle=0;const upd=ev=>{clearTimeout(idle);if(calHalfSyllable(ev))return;if(ev?.isComposing||ev?.type==='compositionend'){idle=setTimeout(()=>{if(calCard===c){calFollowLine(c);show();}},250);return;}calFollowLine(c);show();};title.addEventListener('input',upd);title.addEventListener('compositionend',upd);show();}
  /* the rows in quiet groups on --field, as Calendar's event page (2026-11-06 owner: 「너무 흰 바탕에 글자만 달랑 있어서 좀 횡하게」): when, where and what, how it is kept */
  const group=(...kids)=>{const inside=kids.filter(Boolean);return inside.length?h('div',{class:'card-group'},inside):null;};
  const rows=[head,h('div',{class:'card-title-row'},dot,title),...(hint?[hint]:[])];const when=[].concat(calWhenRow(view)),about=[];
  /* 하루 종일 and 반복 are rows of the group like the others (2026-11-07 owner: 「뜬금없이 안 이쁘게 붙어있고」): a switch at the row's end, as the date popover's 시간 */
  if(!view){when.push(h('div',{class:'card-row card-allday'},h('span',{},tr('하루 종일')),h('label',{class:'checkbox-field'},h('input',{type:'checkbox',id:'card-allday','aria-label':tr('하루 종일'),checked:v.allDay,'data-card-focus':'allday',onchange:ev=>calSetAllDay(ev.target.checked)}))));const repeat=calRepeatControl();if(repeat)when.push(h('div',{class:'card-row'},icon('repeat',16),repeat));}
  else if(isRecurring(e))when.push(h('div',{class:'card-row'},icon('repeat',16),h('span',{},tr('반복 일정'))));
  if(!view)about.push(h('div',{class:'card-row'},icon('mappin',16),h('input',{class:'card-input',type:'text',maxlength:1000,placeholder:tr('장소 추가'),'aria-label':tr('장소'),'data-card-focus':'location',value:v.location,oninput:ev=>{v.location=ev.target.value;},...calEnter(target=>{if(c.mode==='create')calSaveNew(true);else target.blur();}),onblur:()=>{if(c.mode==='edit'&&v.location!==c.original.location){c.original.location=v.location;calCardChange({location:v.location});}}})));
  else if(e.location)about.push(h('div',{class:'card-row'},icon('mappin',16),h('span',{},e.location)));
  about.push(calNotesRow(view));
  const calendars=writableCalendars();
  rows.push(group(...when),group(...about),group(calAlertRow(view),h('div',{class:'card-row'},icon('calendar',16),c.mode==='create'&&calendars.length>1?h('select',{class:'card-select','aria-label':tr('달력'),'data-card-focus':'calendar',onchange:ev=>{c.calendarId=ev.target.value;c.calendarPicked=true;/* 「당일 오전 9시」 cannot go to Google or Outlook: that calendar's default instead */if(typeof v.alert==='number'&&v.alert<0&&!calOnDayAlerts())v.alert=undefined;/* the line read again for the new calendar: an item's 당일 alert comes back on this PC's calendar, as 저장 puts it (2026-11-11 review) */calFollowLine(c,false);calRenderCard();}},calendars.map(x=>h('option',{value:x.id,selected:x.id===c.calendarId?'':null},calendarLabel(x)))):h('span',{class:'card-cal',style:{'--dot':base},title:calendarLabel(cal)||tr('달력')},h('i',{}),h('span',{class:'card-cal-name'},calendarLabel(cal)||tr('달력'))))));
  if(c.swatches)rows.push(h('div',{class:'card-swatches'},eventSwatchPicker(v.color,base,col=>{if(calCard!==c)return;/* a colour from the system picker can come back after this card closed (2026-11-03) */if(D.isCustomColor(col))c.ownColor=col;v.color=col;if(view)colorEventFlow(e,col);else if(c.mode==='edit'&&c.series)calSeriesColor(c,col);else if(c.mode==='edit')calCardChange({color:col});else c.colorMine=true;/* a new event's: the line never gives it back (calLineBack, 2026-11-11) */calRenderCard();},c.ownColor).node));
  if(view)rows.push(h('p',{class:'card-note'},tr('{0} · 읽기 전용',[calendarLabel(cal)||tr('달력')])),h('p',{class:'card-note'},calReadOnlyReason(e)));
  if(c.mode==='create')rows.push(h('footer',{class:'card-footer'},btn(tr('취소'),()=>closeCard(false),'button subtle'),btn(tr('저장'),()=>calSaveNew(true),'button primary')));
  if(c.mode==='edit'&&c.docked&&!e?.history)rows.push(h('div',{class:'card-group card-delete-group'},h('button',{type:'button',class:'card-delete',onclick:()=>calCardDelete()},tr('일정 삭제'))));
  return h('div',{class:'event-card'+(view?' readonly':'')+(c.docked?' docked':''),role:'dialog','aria-label':v.title||e?.title||tr('새 일정'),tabindex:-1,onkeydown:ev=>{if((ev.key==='Delete'||ev.key==='Backspace')&&c.mode==='edit'&&!calFieldFocused()){ev.preventDefault();calCardDelete();}}},rows);
}
// A repeating event's colour from its card: 「이 일정만」 makes the occurrence an exception, so the card's waiting changes go
// in the same request and the card moves to that exception (2026-10-21 review: they were dropped with the card).
function calSeriesColor(c,col){
  // A repeat change waiting in the card cannot go to one occurrence (main keeps a rule only for the series): the colour
  // then waits with it for the scope question on close (2026-10-21 review round 6: 「이 일정만」 dropped the repeat change).
  // Back to the colour the card opened with is no change, as a repeat rule picked back is not (2026-11-09 Argon review).
  const back=String(col||'').toLowerCase()===String(c.original?.color||'').toLowerCase();
  if('rrule' in c.pending){if(back)delete c.pending.color;else c.pending.color=col;return;}
  // A colour picked while other changes wait — the title just left for the swatch, its change in pending — joins them for the one question at
  // close (2026-11-09 owner: the title went out as 「이 일정만」 with the colour's own two choices, or was dropped with 「모든 반복 일정」).
  if(Object.keys(c.pending).length){if(back)delete c.pending.color;else c.pending.color=col;return;}
  // What waits now goes with the colour — nothing, by the line above. A copy, not the object: a change made while the chooser is up stays in
  // pending for the one question at close instead of riding along in this write and staying there too (2026-11-09 review).
  colorEventFlow(c.event,col,{pending:{...c.pending},start:()=>{c.hold=true;},done:r=>{c.hold=false;if(calCard!==c)return;if(r&&r.id){c.event=r;c.key=r.id;c.series=calSeries(r);/* a change still waiting keeps its value on screen (2026-11-09 Argon review) */const kept=c.v;c.original=calValuesOf(r);c.v={...c.original};for(const k of Object.keys(c.pending))if(k in kept)c.v[k]=kept[k];calRenderCard();calMarkAnchor();}else calCardAfterRender();}});}
const calDateLabel=key=>D.fromDate(key).toLocaleDateString(I.locale(),{month:'long',day:'numeric',weekday:'short'});
// The date opens Dayboard's rounded month (2026-11-07 owner: 「너무 직사각형이라 옛날 윈도우 스타일이라 촌스러워」), as a task's date does; an event always has its days, so it offers no 「없음」 (opt.required).
function calDateButton(which){const c=calCard,v=c.v;const key=(which==='start'?v.start:v.end).slice(0,10);const name=which==='start'?tr('시작 날짜'):tr('종료 날짜');return h('span',{class:'card-date-wrap'},h('button',{type:'button',class:'card-date','data-card-focus':'date-'+which,'aria-haspopup':'dialog','aria-label':name+' '+calDateLabel(key),onclick:ev=>datePop(ev.currentTarget,key,false,day=>{if(calCard!==c||!day)return;calSetDate(which,day);c.node?.querySelector('[data-card-focus="date-'+which+'"]')?.focus({preventScroll:true});},name,{required:true})},calDateLabel(key)));}
function calTimeInput(which){const v=calCard.v;const value=which==='start'?v.start:v.end;return h('input',{class:'card-time',type:'text',value:fmtTime(new Date(value)),'aria-label':which==='start'?tr('시작 시간'):tr('종료 시간'),'data-card-focus':'time-'+which,autocomplete:'off',spellcheck:'false',onfocus:ev=>ev.target.select(),onclick:ev=>calTimeMenu(which,ev.currentTarget),oninput:()=>{/* what is typed now is what Enter takes, not the row the arrows left (2026-11-08 Argon review) */if(calCard?.timeList)calCard.timeList.moved=false;},onkeydown:ev=>{if(ev.isComposing)return;if(calTimeListKey(which,ev.currentTarget,ev))return;if(ev.key==='Enter'){ev.preventDefault();closeMenu();calTypedTime(which,ev.currentTarget);}else if(ev.key==='ArrowDown'){ev.preventDefault();calTimeMenu(which,ev.currentTarget);}},onblur:ev=>calTypedTime(which,ev.currentTarget,true)});}
function calWhenRow(view){const c=calCard,v=c.v,e=c.event;if(view)return h('div',{class:'card-row card-when'},icon('clock',16),h('span',{},calDateLabel(D.localKey(e.start))+' · '+timeLabel(e)));/* 시작 and 종료 on a row each, as Calendar's event page (2026-11-07 owner: 「시간이 한 줄 밀리게 나타나」, 「오전 10시 저거는 또 왜 한 줄 내려간 거야」): the label, the date and the time keep their places at any width, the all-day and the several-day event too */const line=(which,label,mark)=>h('div',{class:'card-row card-when'},mark?icon('clock',16):null,h('span',{class:'card-when-label'},label),calDateButton(which),v.allDay?null:calTimeInput(which));return [line('start',tr('시작'),true),line('end',tr('종료'))];}
// Typed times: 3, 15, 1530, 15:30, 3시, 3시 30분, 오후 3시, 3:30pm. With the 12-hour clock a bare 1–7 means the afternoon (Notion).
function calParseClock(text){let t=String(text||'').trim().toLowerCase().replace(/\s+/g,'');if(!t)return null;let pm=null;if(/^(오후|pm)|(오후|pm|p)$/.test(t))pm=true;else if(/^(오전|am)|(오전|am|a)$/.test(t))pm=false;t=t.replace(/오전|오후|am|pm/g,'').replace(/[ap]$/,'');let hrs,mins=0,x,bare=false;if((x=t.match(/^(\d{1,2})시(?:(\d{1,2})분?)?$/))){hrs=+x[1];mins=+(x[2]||0);bare=!x[2];}else if((x=t.match(/^(\d{1,2})[:.](\d{2})$/))){hrs=+x[1];mins=+x[2];}else if((x=t.match(/^(\d{3,4})$/))){hrs=Math.floor(+x[1]/100);mins=+x[1]%100;}else if((x=t.match(/^(\d{1,2})$/))){hrs=+x[1];bare=true;}else return null;if(mins>59||hrs>24)return null;if(pm===true&&hrs<12)hrs+=12;else if(pm===false&&hrs===12)hrs=0;else if(pm===null&&bare&&!/^0/.test(t)&&timeFormat()==='12h'&&hrs>=1&&hrs<=7)hrs+=12;if(hrs===24)hrs=0;return hrs*60+mins;}
const calLocalAt=(key,minutes)=>key+'T'+String(Math.floor(minutes/60)).padStart(2,'0')+':'+String(minutes%60).padStart(2,'0');
function calTypedTime(which,input,quiet){if(quiet&&calCard)calCard.soft=true;try{calTypedTimeNow(which,input,quiet);}finally{if(calCard)calCard.soft=false;}}
function calTypedTimeNow(which,input,quiet){const c=calCard;if(!c)return;const v=c.v;const current=which==='start'?v.start:v.end;const minutes=calParseClock(input.value);if(minutes===null){if(!quiet&&input.value.trim())toast(tr('시간을 알아볼 수 없어요. 예: 15:30, 오후 3시'),true);input.value=fmtTime(new Date(current));return;}const d=new Date(current);if(d.getHours()*60+d.getMinutes()===minutes){input.value=fmtTime(d);return;}calSetTime(which,minutes);}
function calSetTime(which,minutes,endDay){if(!calCard)return;const v=calCard.v;if(which==='start'){const next=calLocalAt(v.start.slice(0,10),minutes);v.end=D.followStart(v.start,next,v.end,false)||v.end;v.start=next;}else{let key=endDay||v.end.slice(0,10);let next=calLocalAt(key,minutes);if(!endDay&&next<=v.start){key=D.dayOffset(v.start.slice(0,10),next.slice(11)<=v.start.slice(11)?1:0);next=calLocalAt(key,minutes);}v.end=next;}calWhenChanged();}
function calTimeMenu(which,input){const c=calCard;if(!c)return;const v=c.v;const r=input.getBoundingClientRect();const start=new Date(v.start);let items,current;if(which==='start'){const day=v.start.slice(0,10);current=Math.round((start.getHours()*60+start.getMinutes())/CAL_STEP);items=Array.from({length:96},(_,i)=>({label:fmtTime(D.atWall(day,i*CAL_STEP)),onClick:()=>{if(calCard===c)calSetTime('start',i*CAL_STEP);}}));}else{const length=Math.round((new Date(v.end)-start)/60000);if(length>1440){/* longer than the 24 hours the list counts from the start: the times of the day it ends on, which stays (2026-11-08 Argon review) */const day=v.end.slice(0,10),end=new Date(v.end);current=Math.round((end.getHours()*60+end.getMinutes())/CAL_STEP);items=Array.from({length:96},(_,i)=>({label:fmtTime(D.atWall(day,i*CAL_STEP)),onClick:()=>{if(calCard===c)calSetTime('end',i*CAL_STEP,day);}}));}else{current=Math.max(0,Math.round(length/CAL_STEP)-1);items=Array.from({length:96},(_,i)=>{const t=new Date(start.getTime()+(i+1)*CAL_STEP*60000);return {label:fmtTime(t),hint:calDuration((i+1)*CAL_STEP),onClick:()=>{if(calCard===c)calSetTime('end',t.getHours()*60+t.getMinutes(),D.dateKey(t));}};});}}contextMenu(r.left,r.bottom+4,{items,cls:'time-menu card-menu'});calFitTimeMenu();calPlaceTimeMenu(r);const nodes=[...(menuRoot?.querySelectorAll('.menu-item')||[])];c.timeList={which,nodes,index:Math.min(current,95),moved:false};const node=nodes[c.timeList.index];if(node){node.classList.add('current');node.scrollIntoView({block:'center'});}input.focus({preventScroll:true});}
// The list hangs from the time pressed, at any panel width (2026-11-07 owner: 「시간을 누른 곳에서 바로 그 자리에」): its right edge on the field's, under it, over it where the window ends.
// Seven whole rows, the chosen one in the middle (2026-11-08 owner: 글자가 위아래로 잘려 보임): the row's height is measured, as 글자 크기 changes it.
function calFitTimeMenu(){const rows=menuRoot?.querySelectorAll('.menu-item');if(!rows||rows.length<2)return;/* to the fraction, without the opening scale: offsetTop's whole pixels let the next row's words show at the foot */menuRoot.style.animation='none';const pitch=rows[1].getBoundingClientRect().top-rows[0].getBoundingClientRect().top,cs=getComputedStyle(menuRoot);menuRoot.style.animation='';const frame=parseFloat(cs.paddingTop)+parseFloat(cs.paddingBottom)+parseFloat(cs.borderTopWidth)+parseFloat(cs.borderBottomWidth);menuRoot.style.maxHeight='min('+(pitch*7+frame)+'px,calc(100vh - 16px))';}
function calPlaceTimeMenu(r){const m=menuRoot;if(!m)return;m.style.animation='none';const b=m.getBoundingClientRect();m.style.animation='';const k=m.currentCSSZoom||1;const below=r.bottom+4,above=r.top-4-b.height;const top=below+b.height<=innerHeight-8||above<8?Math.max(8,Math.min(below,innerHeight-b.height-8)):above;m.style.left=Math.max(8,Math.min(r.right-b.width,innerWidth-b.width-8))/k+'px';m.style.top=top/k+'px';}
// ↑/↓ in a time field move through its open list, Enter picks the marked row (or the typed time when the list was not used).
function calTimeListKey(which,input,ev){const c=calCard;const list=c?.timeList;if(!list||list.which!==which||!menuRoot||!list.nodes[0]?.isConnected)return false;if(ev.key==='ArrowDown'||ev.key==='ArrowUp'){ev.preventDefault();list.nodes[list.index]?.classList.remove('current');list.index=Math.max(0,Math.min(list.nodes.length-1,list.index+(ev.key==='ArrowDown'?1:-1)));const node=list.nodes[list.index];node.classList.add('current');node.scrollIntoView({block:'nearest'});list.moved=true;return true;}if(ev.key==='Enter'&&list.moved){ev.preventDefault();list.nodes[list.index]?.click();c.timeList=null;return true;}return false;}
function calSetDate(which,key){const v=calCard.v;const was=v.start;if(which==='start'){if(v.allDay){v.end=D.followStart(v.start,key,v.end,true)||key;v.start=key;}else{const next=key+v.start.slice(10);v.end=D.followStart(v.start,next,v.end,false)||v.end;v.start=next;}}else if(v.allDay){if(key<v.start){toast(tr('종료 날짜를 시작 날짜와 같거나 뒤로 설정하세요.'),true);calRenderCard();return;}v.end=key;}else{const next=key+v.end.slice(10);if(next<=v.start){toast(tr('종료 시간을 시작 시간 뒤로 설정하세요.'),true);calRenderCard();return;}v.end=next;}calFollowRule(was);calWhenChanged();}
// The repeat moves its weekdays with the start date: a new card's, a repeat chosen and not sent yet, and a card that holds
// the series itself (main moves that one's stored rule too) — 2026-10-21 review: the rule stayed on the old weekday.
function calFollowRule(was){const c=calCard;if(!c||!c.v.rrule)return;const waiting=c.mode==='edit'&&('rrule' in c.pending);const master=c.mode==='edit'&&Boolean(c.event?.rrule&&!c.event.masterId);if(c.mode!=='create'&&!waiting&&!master)return;const next=D.shiftRule(c.v.rrule,was,c.v.start);if(next&&next!==c.v.rrule){c.v.rrule=next;if(waiting)c.pending.rrule=next;}}
function calSetAllDay(on){const c=calCard,v=c.v;if(on===v.allDay)return;if(on){c.timedWas={start:v.start,end:v.end};const startKey=v.start.slice(0,10);let endKey=v.end.slice(0,10);if(v.end.slice(11)==='00:00'&&endKey>startKey)endKey=D.dayOffset(endKey,-1);v.start=startKey;v.end=endKey<startKey?startKey:endKey;}else{const day=v.start.slice(0,10);const last=String(v.end||day).slice(0,10);const lastDay=last>day?last:day;/* v.end is the last day itself while all-day (calValuesOf); a several-day event keeps its days (Codex review 2026-10-26) *//* off again on the same days: the times it had; else the next whole hour (2026-11-07 owner) */const old=c.timedWas;const oldLast=old?(old.end.slice(11)==='00:00'&&old.end.slice(0,10)>old.start.slice(0,10)?D.dayOffset(old.end.slice(0,10),-1):old.end.slice(0,10)):'';const had=old&&old.start.slice(0,10)===day&&oldLast===lastDay?old:null;const next=D.defaultEventTimes(day);const times=had?[had.start,had.end]:lastDay===day?next:[next[0],next[1].startsWith(day)?lastDay+next[1].slice(10):D.dayOffset(lastDay,1)+'T00:00'];v.start=times[0];v.end=times[1];}/* an alert the line put (calFollowLine) is not the card's: the one it replaced is the card's again before the kinds' memory, and the line, read again (calWhenChanged), puts its item's alert of the new kind only — 「저녁」's 10분 전 became 당일 오전 9시 and went out with the event, where 71305ad sent none (2026-11-11 review) */const line=c.mode==='create'?c.line:null;if(line&&'alert' in line.to&&!c.alertMine&&v.alert===line.to.alert){v.alert=line.from.alert;delete line.to.alert;delete line.from.alert;}/* the card remembers the alert each kind had, so 하루 종일 on and off gives 「1시간 전」 back (2026-10-27 review) — on a new card not one of the other kind's, which the line's change left (calAlertKind) */const kept=c.alerts||(c.alerts={});if(c.mode!=='create'||!calAlertOther(v.alert,v.allDay))kept[v.allDay?'allDay':'timed']=v.alert;v.allDay=on;if(typeof v.alert==='number'){v.alert=calKindAlert(c,on);if(c.mode==='edit')calCardChange({alert:v.alert});}calWhenChanged();/* the card was drawn again: the new switch starts where the old one stood and slides — not when the line, read again at the card's first values (N4), turned it back: the switch shows what is */const sw=calCard?.node?.querySelector('#card-allday');if(sw&&calCard.v.allDay===on){sw.checked=!on;void sw.offsetWidth;sw.checked=on;}}
/* the timed and the all-day alerts share no value (domain.js ALERTS_TIMED, ALERTS_ALLDAY): a number of the other kind's list was picked for that kind */
const calAlertOther=(alert,allDay)=>typeof alert==='number'&&(allDay?D.ALERTS_TIMED:D.ALERTS_ALLDAY).includes(alert);
/* the alert a kind gets when the event turns to it: the one it had on this card, else that kind's default (2026-10-27 review) */
function calKindAlert(c,on){const back=c.alerts?.[on?'allDay':'timed'];const fits=typeof back==='number'&&(on?(back>=0||calOnDayAlerts()):back>=0);return fits?back:on?(calOnDayAlerts()?-540:900):10;}
function calWhenChanged(){const c=calCard;if(!c)return;/* the day, time or 하루 종일 changed by hand over what the line put there is the user's from now on, even back at the card's first values (2026-11-11 calFollowLine); before the line put any, N4's comparison in calReadTitle decides as ever */if(c.line?.to.when)c.whenMine=true;/* a hand change: the card goes beside its event again (calCardAfterRender lineHold) */c.lineHold=false;if(c.soft){if(c.mode==='create'){calDraft=calTimes(c.v);/* the draft block follows a time left with Tab; a frame later, and not under a press that took the focus (2026-11-09 F76) */requestAnimationFrame(()=>{if(calCard===c&&!calGesture)render();});}else calCardChange(calTimes(c.v));calSyncWhen(c);return;}if(c.mode==='create'){/* the line read again over the hand's change, not drawn: an item's alert for the new kind shows now, as 저장 puts it, not at the next key (2026-11-11 review); calRenderCard draws it, after the field pressed is remembered (calLineDraw here would take it away first). Not after Tab: only a time changed, and the card is not drawn */calFollowLine(c,false);calDraft=calTimes(c.v);calRenderCard();render();return;}calCardChange(calTimes(c.v));calRenderCard();}
// The time fields and date labels shown again from the values, without rebuilding the card.
function calSyncWhen(c){const v=c.v;if(v.allDay||!c.node)return;for(const which of ['start','end']){const input=c.node.querySelector('[data-card-focus="time-'+which+'"]');if(input&&document.activeElement!==input)input.value=fmtTime(new Date(which==='start'?v.start:v.end));}}
// Repeat presets worked out from the event's own date (Notion, Google), the current rule when it is none of them, and 사용자 지정….
function calRepeatOptions(day,current){const d=D.fromDate(day);const wd=I.weekdays('long')[d.getDay()];const o=ordinalOf(d);const weekly=n=>D.buildRRule({freq:'WEEKLY',interval:n,byDay:[{ord:0,day:d.getDay()}],wkst:0});const list=[['',tr('반복 안 함')],['FREQ=DAILY',tr('매일')],[weekly(1),tr('매주 {0}',[wd])],['FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR;WKST=SU',tr('평일마다 (월–금)')],[weekly(2),tr('2주마다 {0}',[wd])],['FREQ=MONTHLY',monthlyLabel('date',d)],['FREQ=MONTHLY;BYDAY='+Math.min(o.nth,4)+D.RRULE_DAYS[d.getDay()],monthlyLabel('nth',d)],o.last?['FREQ=MONTHLY;BYDAY=-1'+D.RRULE_DAYS[d.getDay()],monthlyLabel('last',d)]:null,['FREQ=YEARLY',tr('매년 {0}',[d.toLocaleDateString(I.locale(),{month:'long',day:'numeric'})])]].filter(Boolean);if(o.nth===5)list.splice(6,1);const match=list.find(([value])=>calSameRule(value,current,d.getDay()));if(current&&!match){const rule=D.parseRRule(current);list.push([current,rule?describeRule(rule,d):current]);}list.push(['custom',tr('사용자 지정…')]);return {list,value:match?match[0]:current};}
function calSameRule(a,b,day){if(!a||!b)return !a&&!b;const x=D.parseRRule(a),y=D.parseRRule(b);if(!x||!y)return a===b;/* a weekly rule without BYDAY repeats on its start's weekday, which the picker writes out (2026-11-09 F48) */const days=r=>(r.freq==='WEEKLY'&&!r.byDay.length&&day!=null?[{ord:0,day}]:r.byDay).map(d=>d.ord+':'+d.day).sort().join();return x.freq===y.freq&&x.interval===y.interval&&days(x)===days(y)&&x.byMonthDay===y.byMonthDay&&x.count===y.count&&x.until===y.until;}
const calServiceName=cal=>({google:tr('Google 캘린더'),microsoft:'Outlook',icloud:tr('Apple 달력')})[cal?.provider]||tr('원래 달력 앱');
function calRepeatControl(){const c=calCard,v=c.v,e=c.event;if(e&&e.masterId&&!e.rrule&&isLocalEvent(e))return null;if(e&&!isLocalEvent(e)&&e.recurring){/* the rule belongs to the service (2026-11-09 owner: 「우측 세부항목 탭에서 반복 일정을 누르려고 하는데 아무런 변화가 안 나와」): the rule's words when the service gave them, with a lock, and a press or Enter says where it is changed; a plain span answered nothing */const said=tr('반복 규칙은 {0}에서 바꿀 수 있어요.',[calServiceName(calendarOf(e))]);return h('button',{type:'button',class:'card-value card-repeat-locked','data-card-focus':'repeat','aria-label':said,title:said,onclick:()=>toast(said)},h('span',{},e.rrule?describeRule(D.parseRRule(e.rrule),D.fromDate(v.start.slice(0,10))/* the card's own day: an all-day start read as a Date was UTC midnight, the day before west of Greenwich (2026-11-09 Argon review) */):tr('반복 일정')),icon('lock',12));}const {list,value}=calRepeatOptions(v.start.slice(0,10),v.rrule);return h('select',{class:'card-repeat','aria-label':tr('반복'),'data-card-focus':'repeat',onchange:ev=>{const next=ev.target.value;if(next==='custom'){ev.target.value=value;calCustomRepeat();return;}v.rrule=next;/* back to the rule it opened with is no change: 「이 일정만」 stays on offer when the card closes (2026-11-08 Argon review) */if(c.mode==='edit'){if(c.series&&calSameRule(next,e?.rrule||'',D.fromDate(v.start.slice(0,10)).getDay()))delete c.pending.rrule;else calCardChange({rrule:next});}calRenderCard();}},list.map(([val,label],i)=>[i===1||val==='custom'?h('hr'):null,h('option',{value:val,selected:val===value?'':null},label)]));}/* hairlines: 반복 안 함 | the rules | 사용자 지정… (Apple Calendar's groups, area H) */
// ---- 알림 (1.1.3, Apple Calendar): one alert per event, minutes before the start (an all-day event's from its midnight). A new
// event on a connected calendar starts on that calendar's own default (nothing is sent); Google and Outlook keep only alerts
// before the start, so 「당일 오전 9시」 is offered on this PC's and iCloud calendars.
function calCardCalendar(){const c=calCard;return c.mode==='create'?state.calendars.find(x=>x.id===c.calendarId):calendarOf(c.event);}
function calOnDayAlerts(){const cal=calCardCalendar();return !cal||cal.provider==='local'||cal.provider==='icloud';}
function calAlertRow(view){const c=calCard,v=c.v;const label=value=>alertLabel(value,v.allDay);if(view){const a=c.event?.alert;return typeof a==='number'?h('div',{class:'card-row'},icon('bell',16),h('span',{},label(a))):null;}
  const cal=calCardCalendar();const connected=cal&&cal.provider!=='local';const values=(v.allDay?D.ALERTS_ALLDAY.filter(m=>m>=0||calOnDayAlerts()):D.ALERTS_TIMED).slice();if(typeof v.alert==='number'&&!values.includes(v.alert))values.push(v.alert);values.sort((a,b)=>a-b);
  const options=[];if(c.mode==='create'&&connected)options.push(['default',typeof cal.defaultAlert==='number'&&!v.allDay?tr('기본값 ({0})',[label(cal.defaultAlert)]):tr('달력 기본값')]);options.push(['none',tr('알림 없음')]);for(const m of values)options.push([String(m),label(m)]);
  const current=v.alert===undefined?(c.mode==='create'&&connected?'default':'none'):v.alert===null?'none':String(v.alert);
  return h('div',{class:'card-row'},icon('bell',16),h('select',{class:'card-select card-alert','aria-label':tr('알림'),'data-card-focus':'alert',onchange:ev=>{const next=ev.target.value;v.alert=next==='default'?undefined:next==='none'?null:Number(next);if(c.mode==='edit')calCardChange({alert:v.alert===undefined?null:v.alert});else c.alertMine=true;/* chosen by hand: the line never gives it back (calLineBack, 2026-11-11) */}},options.map(([value,text],i)=>[i&&options[i-1][0]==='none'?h('hr'):null,h('option',{value,selected:value===current?'':null},text)])));}/* a hairline under 알림 없음 (area H) */
function calCustomRepeat(){const c=calCard;const v=c.v;const start=h('input',{type:'hidden',value:v.allDay?v.start:v.start});const picker=repeatPicker(v.rrule,start,{expand:true});modal(tr('반복'),h('form',{class:'dialog-body',onsubmit:ev=>{ev.preventDefault();const next=picker.value();closeModal();if(calCard!==c)return;v.rrule=next;/* confirmed unchanged is no rule change, as in the menu above (2026-11-09 F48) */if(c.mode==='edit'){if(c.series&&calSameRule(next,c.event?.rrule||'',D.fromDate(v.start.slice(0,10)).getDay()))delete c.pending.rrule;else calCardChange({rrule:next});}calRenderCard();}},picker.node,actionFooter(()=>closeModal(),tr('확인'))),false,{stack:true});}
function calCardMenu(anchor){const c=calCard;const e=c.event;const r=anchor.getBoundingClientRect();contextMenu(r.left,r.bottom+4,{items:[{label:tr('복제'),icon:'copy',hint:isRecurring(e)?tr('이 일정만'):'',onClick:()=>{if(calCard!==c)return;const copy={...e,title:c.v.title.trim()||e.title,location:c.v.location,notes:c.v.notes,...(c.v.color?{color:c.v.color}:{}),...calTimes(c.v)};if(!c.v.color)delete copy.color;if(!closeCard(true))return;duplicateEvent(copy);}},c.mode==='edit'?'-':null,c.mode==='edit'?{label:tr('삭제'),icon:'trash',danger:true,onClick:()=>{if(calCard===c)calCardDelete();}}:null]});menuRoot?.classList.add('card-menu');}
function calCardDelete(){const c=calCard;if(!c||c.mode!=='edit')return;deleteEventFlow(c.event);}
// Saving: one change of a plain event goes out after 400ms; a repeating event keeps its changes until the card closes and
// then asks once how far they apply (Notion's pending changes).
function calCardChange(fields){const c=calCard;if(!c||c.mode!=='edit')return;Object.assign(c.pending,fields);if(c.series)return;clearTimeout(c.timer);c.timer=setTimeout(()=>calCardFlush(c).catch(()=>{}),400);}
// One write at a time. When quitting (strict, or a quit waits on this write) a failed change stays waiting for 다시 시도 and
// the failure goes to main's dialog; otherwise the card shows the stored values again (2026-10-21 review).
// Card writes on their way: a window close or the quit waits for them, and one that failed stops it with main's dialog
// (2026-10-21 review round 6: the window's X closed the card first, so its write was neither waited for nor reported).
const calWrites=new Set();
async function calCardFlush(c,strict){if(!c||c.series)return;clearTimeout(c.timer);c.timer=null;if(c.flushing)await c.flushing.catch(()=>{});const pending=c.pending;if(!Object.keys(pending).length)return;c.pending={};const job=run('event:update',{id:c.event.id,...pending});c.flushing=job;calWrites.add(job);try{const r=await job;if(calCard===c&&r&&r.id){c.event=r;c.key=r.id;const series=calSeries(r);if(series!==c.series){c.series=series;calRenderCard();}calMarkAnchor();}}catch(error){if(strict||c.strict){c.pending={...pending,...c.pending};job.requeued=true;throw error;}if(calCard===c){const back=calValuesOf(c.event);const keys=Object.keys(pending);/* a field changed again after this write went keeps the new value (Codex 1.2.10 fourth review F3: typing B after A's save failed lost B); c.original goes back, so the next blur sends it */const sent=k=>keys.includes(k)&&(c.v[k]||'')===(pending[k]||'');if(sent('title'))c.v.title=back.title;if(sent('location'))c.v.location=back.location;if(sent('notes'))c.v.notes=back.notes;if(keys.includes('color'))c.v.color=back.color;if(keys.includes('rrule'))c.v.rrule=back.rrule;if(keys.includes('alert'))c.v.alert=back.alert;if(keys.some(k=>['start','end','allDay'].includes(k))){c.v.start=back.start;c.v.end=back.end;c.v.allDay=back.allDay;}c.original={...c.original,...Object.fromEntries(keys.filter(k=>k in back).map(k=>[k,back[k]]))};if(!(c.node&&c.node.contains(document.activeElement)&&calFieldFocused()))calRenderCard();}}finally{calWrites.delete(job);if(c.flushing===job)c.flushing=null;}}
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
function calAddPayload(c,title){const payload={calendarId:c.calendarId,title,...calTimes(c.v),location:c.v.location,...(String(c.v.notes||'').trim()?{notes:c.v.notes}:{}),...(c.v.color?{color:c.v.color}:{}),...(c.v.rrule?{rrule:c.v.rrule}:{}),...(c.v.alert!==undefined?{alert:c.v.alert}:{}),key:c.addKey};if(c.sentPayload&&JSON.stringify(c.sentPayload)!==JSON.stringify(payload))c.revise=true;c.sentPayload={...payload};if(c.revise)payload.revise=true;return payload;}
/* A series card is gone once its scope is answered: a failed save keeps its edit behind 「다시 시도」, as calAddFailed does (2026-11-09 F25) */function calSendUpdate(payload,title){const job=run('event:update',payload);calWrites.add(job);job.catch(()=>toast(tr('「{0}」 일정을 저장하지 못했어요.',[shortTitle(title||'')||tr('제목 없는 일정')]),true,{label:tr('다시 시도'),undo:false,onClick:()=>calSendUpdate(payload,title)})).finally(()=>calWrites.delete(job));return job;}
function calAddFailed(payload){if(!calFailedAdds.includes(payload))calFailedAdds.push(payload);toast(tr('「{0}」 일정을 저장하지 못했어요.',[shortTitle(payload.title)]),true,{label:tr('다시 시도'),undo:false,onClick:()=>{if(calFailedAdds.includes(payload))calSendAdd(payload,true).catch(()=>calAddFailed(payload));}});}
// Only this card's ghost block goes: a new draft opened since then keeps its own.
const calDropDraft=c=>{if(!(calCard&&calCard!==c&&calCard.mode==='create'))calDraft=null;};
/* A new event's title as one line (2026-11-05 owner: 「안경 구매, 2시, 젠트리 안경」 → 제목·오후 2시·장소; 「12/7 10시 영어 시험 대강의실」 → 12월 7일 10시): what domain.parseEventKo understood, applied on save — the day the card was opened for unless a date is typed, the card's length kept (an hour from 하루 종일), a place typed only when the place field is empty. */
function calReadTitle(c){const shown=c?.v;if(!shown||c.mode!=='create')return null;/* read from the values without the line (2026-11-11): days and hours the line put in the form, while they are as it put them, count as the ones they replaced (calFollowLine) */const back=c.line?.to.when&&!c.whenMine&&JSON.stringify([shown.start,shown.end,shown.allDay])===c.line.to.when?c.line.from.when:null;const v=back?{...shown,start:back[0],end:back[1],allDay:back[2]}:shown;/* a day, time or 하루 종일 the user chose after opening the card wins over the line (Codex third review N4): the line is read only while they are as the card opened; one changed by hand over the line's stays chosen (whenMine) */const when=JSON.stringify([v.start,v.end,v.allDay]);if(c.whenAtOpen===undefined)c.whenAtOpen=when;/* days drawn on the calendar were chosen: a time in the line would make them an hour of the first (Argon recheck GN8). After the check above, which remembers them for when they are brought back to one (Codex third check N2) */const kept=Boolean(c.whenMine)||c.whenAtOpen!==when||(v.allDay&&v.end>v.start);/* the preview and the save read 「내일」 from one moment: the time the line last changed (N5) */const raw=String(v.title||'');if(c.titleParseText!==raw){c.titleParseText=raw;c.titleParseNow=new Date();}/* read even when the hours stay: 「점심 7시까지 제출」 is left alone on any card (Codex 2026-11-08 F2) */const seen={};const line=D.parseEvent(raw,c.titleParseNow,seen);let p=kept?null:line;/* a place already in its field and another in the line: nothing is taken out of the title (N3) */if(p?.location&&String(v.location||'').trim())p=null;/* 자주 쓰는 일정 (domain.js applyShortcut): the title takes its shape whatever else was chosen; hours from the time grid or the card stay. 그대로 leaves this word alone on this card. */const hit=D.applyShortcut(raw,p,state.settings.eventShortcuts,{chosen:kept||!v.allDay,stopped:seen.stopped});const read=hit&&c.shortcutOff!==D.shortcutKey(hit.shortcut.word)?hit:p;if(!read)return null;const baseDay=v.allDay?v.start:D.localKey(new Date(v.start));const day=read.date||baseDay;return {...read,day,place:read.location&&!String(v.location||'').trim()?read.location:''};}
function calShortcutCalendar(c,s){return s.calendarId&&!c.calendarPicked?writableCalendars().find(x=>x.id===s.calendarId)||null:null;}
/* what the card still has at its default takes the item's; a calendar another PC has and this one does not stays on the automatic one (calTitleHint says so) */function calShortcutKeep(c,s){const v=c.v;const cal=calShortcutCalendar(c,s);if(cal)c.calendarId=cal.id;if(s.color&&!v.color)v.color=s.color;/* an alert of the item's kind only: a timed one counts minutes before the start, an all-day one a time on a day before (Argon 2026-11-08 G4) */if(s.alert!==undefined&&v.alert===undefined&&(s.alert===null||s.allDay===v.allDay))v.alert=s.alert;if(typeof v.alert==='number'&&v.alert<0&&!calOnDayAlerts())v.alert=undefined;}
function calApplyTitle(c){/* from the values without the line, as before the form followed it (2026-11-11): what is saved for a line is unchanged */if(c.line)calLineBack(c);const p=calReadTitle(c);if(!p)return;const v=c.v,was=v.allDay;v.title=p.title;c.title=p.title;if(p.place)v.location=p.place;if(p.allDay){/* v.end is the last day itself while all-day (calValuesOf): one day stays one (Codex sixth review N2), several keep their length */const span=v.allDay?Math.round((new Date(v.end+'T00:00:00')-new Date(v.start+'T00:00:00'))/864e5):0;v.allDay=true;v.start=p.day;v.end=D.dayOffset(p.day,span);}else if(p.time){const minutes=p.minutes||(p.end?(p.end.h-p.time.h)*60+p.end.m-p.time.m:v.allDay?60:Math.max(15,Math.round((new Date(v.end)-new Date(v.start))/60000)));const s=new Date(p.day+'T00:00:00');s.setHours(p.time.h,p.time.m,0,0);v.allDay=false;v.start=toLocalInput(s.toISOString());v.end=toLocalInput(new Date(s.getTime()+minutes*60000).toISOString());}else if(p.date){if(v.allDay){const span=Math.round((new Date(v.end+'T00:00:00')-new Date(v.start+'T00:00:00'))/864e5);v.start=p.day;v.end=D.dayOffset(p.day,span);}else{const s0=new Date(v.start),e0=new Date(v.end);const s=new Date(p.day+'T00:00:00');s.setHours(s0.getHours(),s0.getMinutes(),0,0);v.start=toLocalInput(s.toISOString());v.end=toLocalInput(new Date(s.getTime()+(e0-s0)).toISOString());}}if(p.shortcut)calShortcutKeep(c,p.shortcut);/* after the item's calendar, which lets 당일 오전 9시 go to that calendar's default as before */calAlertKind(c,was);}
/* The line turning 하루 종일 on or off does to an alert picked for the other kind what the switch does (calSetAllDay): that kind's own on this
   card, else its default (2026-11-11 review: 당일 오전 9시 then 「저녁」 went out as 「-9시간 전」, 10분 전 then 「내일 하루 종일 워크숍」 as
   「1일 전 23:50」 — 71305ad saved those too, unseen until the form followed the line). It is the line's while the word is there: the one picked
   comes back with the word's going (calLineBack), as an alert an item's calendar cannot keep. Only a number of the other kind's list (the lists
   share none); one picked while the line had the event in the other kind stays the user's when the word goes (the line never touches it). */
function calAlertKind(c,was){const v=c.v;if(v.allDay===was||!calAlertOther(v.alert,v.allDay))return;(c.alerts||(c.alerts={}))[was?'allDay':'timed']=v.alert;v.alert=calKindAlert(c,v.allDay);}
// The line read as it is typed (2026-11-11 owner: 「저녁 치면 하루종일 on/off 토글이 off로 바뀌어야 하는데 안 바뀌어」 — the V46 answer 「지금처럼
// 안내 줄만」 of 2026-11-09 reversed): a new event's form shows what 저장 would make — 하루 종일, the days and hours, the calendar, colour and alert
// an item fills. The line's values are marked (c.line: what they replaced, what they are) and given back when the line stops making them; a
// control changed by hand is the user's and is never given back (whenMine, colorMine, alertMine, calendarPicked). The title and the place stay as
// typed, and the hint says them: a place put in its field would be the user's by N3 and stop the line being read. 저장 reads from the values
// without the line (calApplyTitle), so what is saved for a line and a set of choices is as before (tests/shortcut-live-1111.test.cjs).
const calLineShown=c=>JSON.stringify([c.v.start,c.v.end,c.v.allDay,c.v.color||null,c.v.alert===undefined?'default':c.v.alert,c.calendarId]);
function calLineBack(c){const line=c.line;if(!line)return;c.line=null;const v=c.v,{from,to}=line;if(to.when&&!c.whenMine){if(JSON.stringify([v.start,v.end,v.allDay])===to.when)[v.start,v.end,v.allDay]=from.when;else c.whenMine=true;}if('color' in to&&!c.colorMine&&v.color===to.color)v.color=from.color;if('alert' in to&&!c.alertMine&&v.alert===to.alert)v.alert=from.alert;if('calendarId' in to&&!c.calendarPicked&&c.calendarId===to.calendarId)c.calendarId=from.calendarId;}
/* draw false: a hand change draws the whole card right after (calWhenChanged, the calendar's select) */
function calFollowLine(c,draw=true){if(!c||calCard!==c||c.mode!=='create'||c.saving)return;const v=c.v,shown=calLineShown(c);calLineBack(c);const from={when:[v.start,v.end,v.allDay],color:v.color,alert:v.alert,calendarId:c.calendarId};const typed=v.title,said=c.title,place=v.location;calApplyTitle(c);v.title=typed;c.title=said;v.location=place;const to={},was={};const when=JSON.stringify([v.start,v.end,v.allDay]);if(when!==JSON.stringify(from.when)){to.when=when;was.when=from.when;}for(const k of ['color','alert'])if(v[k]!==from[k]){to[k]=v[k];was[k]=from[k];}if(c.calendarId!==from.calendarId){to.calendarId=c.calendarId;was.calendarId=from.calendarId;}c.line=Object.keys(to).length?{from:was,to}:null;/* the line turning 하루 종일 on keeps the hours it replaced, as the switch does (calSetAllDay timedWas): off by hand gives the hour pressed back, not the next whole hour (2026-11-11 review) */if(to.when&&!from.when[2]&&v.allDay)c.timedWas={start:from.when[0],end:from.when[1]};/* a colour or alert the line put over the user's is the line's until changed again: the user's comes back with the word's going */if('color' in to)c.colorMine=false;if('alert' in to)c.alertMine=false;/* nothing drawn while the reading stays the same: no flicker as the rest of the line is typed */if(!draw||calLineShown(c)===shown)return;const old=JSON.parse(shown);calLineDraw(c,old[2]!==v.allDay,JSON.stringify(old.slice(0,3))!==when);}
/* The card's rows drawn again around the title, which keeps its node — focus, caret and an IME composition stay; the draft on the board follows a frame later, and with the Korean IME when the syllable being made is done (render waits for a composition to end, app.js — letting it draw then is for an Electron check first, 2026-11-11 review) */
function calLineDraw(c,flipped,moved){/* a field drawn again while the Korean IME makes a syllable in it (the place typed at once after the title, before the title's quarter second, calCardNode upd): replaced, the half-made syllable is committed and the next key starts another — 「가」+「ㅇ」, not 「강」 (2026-11-13 Codex review U3; the keyboard kept by e332c7f, the syllable not). Drawn once that syllable is done; the title's own row is kept, so a syllable there does not wait */{const a=document.activeElement;if(composing&&c.node?.contains(a)&&!a.closest('.card-head,.card-title-row,.card-hint')){const w=c.lineWait;c.lineWait={flipped:Boolean(w?.flipped||flipped),moved:Boolean(w?.moved||moved)};if(!w)document.addEventListener('compositionend',()=>setTimeout(()=>{const x=c.lineWait;c.lineWait=null;if(x&&calCard===c)calLineDraw(c,x.flipped,x.moved);},0),{once:true});return;}}/* back at the card's first values, the board as it opened: a month day had no draft, and a bar left there moved that week's events a row down (2026-11-11 review) */if(moved)calDraft=!c.line?.to.when&&!c.whenMine&&JSON.stringify([c.v.start,c.v.end,c.v.allDay])===c.whenAtOpen?(c.draftOpen&&{...c.draftOpen}):calTimes(c.v);const old=c.node;if(!old?.isConnected)return;/* the keyboard on a row drawn again comes to that row's new control, its caret too: Tab out of the title before the quarter second of the Korean IME left it on the page (2026-11-13 review) */const a=document.activeElement;const fk=old.contains(a)&&!a.closest('.card-head,.card-title-row,.card-hint')?a.closest('[data-card-focus]')?.getAttribute('data-card-focus')||null:null;const sel=fk&&typeof a.selectionStart==='number'?[a.selectionStart,a.selectionEnd]:null;const next=calCardNode();const keep=n=>n.matches('.card-head,.card-title-row,.card-hint');const dot=old.querySelector('.card-title-row>.card-color'),fresh=next.querySelector('.card-title-row>.card-color');if(dot&&fresh)dot.replaceWith(fresh);for(const n of [...old.children])if(!keep(n))n.remove();old.append(...[...next.children].filter(n=>!keep(n)));if(fk){const f=old.querySelector('[data-card-focus="'+fk+'"]');if(f){f.focus({preventScroll:true});if(sel)try{f.setSelectionRange(sel[0],sel[1]);}catch{}}}/* the switch slides as when it is pressed (calSetAllDay) */if(flipped){const sw=old.querySelector('#card-allday');if(sw){const on=sw.checked;sw.checked=!on;void sw.offsetWidth;sw.checked=on;}}const b=old.getBoundingClientRect();if(b.bottom>innerHeight-12)calPlaceCard();if(moved){/* the card being typed in stays where it stands (calCardAfterRender) */c.lineMoved=true;c.lineHold=true;requestAnimationFrame(()=>{if(calCard===c&&!calGesture)render();});}}
/* a letter the IME has not made a syllable yet (the ㅇ of 「저녁ㅇ」): read, it would give back what the word before it set one key early; a whole syllable is read as the hint always read it */
const calHalfSyllable=ev=>Boolean(ev?.isComposing)&&/[\u1100-\u11ff\u3131-\u318e]$/.test(String(ev.data||''));
function calHintText(c){/* 저장하면: the title and the place go in at the save; the days and hours are in the form already (2026-11-11) */const text=calTitleHint(c);if(!text)return '';/* an item's word that leaves the title as typed (「저녁」, 「저녁 민수」): where the form's change came from, beside 그대로, not the title over again (2026-11-11 review) */const p=calReadTitle(c);if(p?.shortcut&&text===p.title&&p.title===String(c.v.title||'').replace(/\s+/g,' ').trim())return tr('자주 쓰는 일정');return tr('저장하면 {0}',[text]);}
/* only what the form cannot show (2026-11-11): the title saved, the place, an item's calendar this PC does not have. A plain line saved as typed says nothing; an item's word keeps its line, where 그대로 is */
function calTitleHint(c){const p=calReadTitle(c);if(!p)return '';const lost=p.shortcut?.calendarId&&!c.calendarPicked&&!calShortcutCalendar(c,p.shortcut)?tr('달력을 찾지 못해 자동으로 저장'):'';if(!p.shortcut&&!p.place&&!lost&&p.title===String(c.v.title||'').replace(/\s+/g,' ').trim())return '';return [p.title,p.place,lost].filter(Boolean).join(' · ');}
function calSaveNew(explicit){const c=calCard;if(!c||c.mode!=='create'||c.saving)return;calCommitTyped(c);calApplyTitle(c);const title=c.v.title.trim()||(explicit?tr('새 일정'):'');if(!title){calCard=null;calCardRoot().replaceChildren();calDraft=null;render();return;}c.saving=true;c.addKey||=calNewKey();const payload=calAddPayload(c,title);c.savePayload=payload;const job=calSendAdd(payload,true);c.savePromise=job;job.then(created=>{if(calCard===c){calCard=null;calCardRoot().replaceChildren();}calDropDraft(c);render();const day=D.localKey(payload.start);if(day!==selectedDate&&view==='calendar'&&calMode()==='month'){selectedDate=day;render();}const id=payload.calendarId;const cal=state.calendars.find(x=>x.id===id);if(cal&&(state.settings.hiddenCalendars||[]).includes(id))toast(tr('숨긴 달력 「{0}」에 저장했어요.',[cal.name]),false,{label:tr('달력 표시'),undo:false,onClick:()=>run('settings:update',{hiddenCalendars:(state.settings.hiddenCalendars||[]).filter(x=>x!==id)}).catch(()=>{})});void created;},()=>{c.saving=false;/* the card is still open: its values stay for another try, drawn as they were read */if(calCard===c){calRenderCard();return;}calDropDraft(c);render();calAddFailed(payload);});}
// Closing: Esc, an outside click, another event, a view change. Returns false when the card stays (a scope question is open).
function closeCard(commit=true,giveBack=true){
  const c=calCard;if(!c)return true;if(c.closing)return false;
  if(c.mode==='create'){if(commit)calSaveNew(false);else{calCard=null;calCardRoot().replaceChildren();if(calDraft){calDraft=null;render();}}return true;}
  if(c.mode==='edit'&&commit){const active=document.activeElement;if(c.node&&c.node.contains(active)&&calFieldFocused())active.blur();}
  if(c.mode==='edit'&&commit&&c.series&&Object.keys(c.pending).length){const labels=calScopeLabels(c.event,c.pending);if(!labels.one&&!labels.future&&!labels.all){delete c.pending.rrule;toast(tr('하루 종일 변경과 반복 변경은 따로 저장해 주세요. 반복 변경은 빼고 저장했어요.'),true);}}
  if(c.mode==='edit'&&commit&&c.series&&Object.keys(c.pending).length){c.closing=true;calAskScope(tr('「{0}」 반복 일정을 어떻게 저장할까요?',[shortTitle(c.event.title)||tr('제목 없는 일정')]),calScopeLabels(c.event,c.pending)).then(scope=>{c.closing=false;if(!scope)return;const pending=c.pending;c.pending={};if(calCard===c){calCard=null;calCardUnmount(c);}calSendUpdate({id:c.event.id,scope,...pending},c.event.title);});return false;}
  if(c.mode==='edit'&&commit)calCardFlush(c).catch(()=>{});else clearTimeout(c.timer);
  const hadFocus=Boolean(c.node&&c.node.contains(document.activeElement));
  calCard=null;calCardUnmount(c);for(const n of document.querySelectorAll('.card-open'))n.classList.remove('card-open');
  /* giveBack false, or a line being deleted (goingAway in app.js): the keyboard goes beside it (deleteEventFlow) */
  const back=calFindAnchor(c);if(back&&hadFocus&&giveBack&&!(typeof goingAway==='function'&&goingAway(back)))back.focus({preventScroll:true});
  return true;
}
// Beside the anchor with an 8px gap (right, else left, else below or above), top-aligned, 12px inside the window.
function calPlaceCard(rect){const c=calCard;const node=c?.node;if(!node)return;if(rect)c.rect=rect;if(c.docked)return;const r=c.rect;const w=node.offsetWidth||360,hgt=node.offsetHeight||320;let left,top;if(!r){left=(innerWidth-w)/2;top=Math.max(12,(innerHeight-hgt)/3);}else if(r.right+8+w<=innerWidth-12){left=r.right+8;top=r.top;}else if(r.left-8-w>=12){left=r.left-8-w;top=r.top;}else{left=Math.min(Math.max(12,r.left),innerWidth-w-12);top=r.bottom+8+hgt<=innerHeight-12?r.bottom+8:r.top-8-hgt;}top=Math.max(12,Math.min(top,innerHeight-hgt-12));node.style.left=Math.round(left)+'px';node.style.top=Math.round(top)+'px';}
const calAnchorRegions='.day-panel,.context-pane,.time-sticky,.time-body,.calendar-grid';
function calFindAnchor(c){if(c?.mode==='list'&&c.day){const by=k=>document.querySelector('#app [data-focus-key="'+CSS.escape(k)+'"]');return by('more-'+c.day)||by('day-'+c.day);}/* the 「+n개」 list goes back to its button (2026-11-02 r60 integration cal-4) */if(!c?.key)return null;const sel='[data-event-key="'+CSS.escape(c.key)+'"]';const piece=c.piece&&document.querySelector('#app [data-focus-key="'+CSS.escape(c.piece)+'"]');if(piece)return piece;return (c.region&&document.querySelector('#app '+c.region+' '+sel))||document.querySelector('#app '+sel);}
function calMarkAnchor(){for(const n of document.querySelectorAll('.card-open'))n.classList.remove('card-open');const c=calCard;if(!c||!c.key)return null;const anchor=calFindAnchor(c);anchor?.classList.add('card-open');return anchor;}
function calCardAfterRender(){const c=calCard;if(!c||!c.node)return;/* its day panel gone (a narrower window, the panel hidden in another window): the card floats beside its event again, its typing with it (2026-11-05) */if(c.docked&&!c.node.isConnected){c.docked=false;calRenderCard();}if(c.mode==='list'){if(view!=='calendar')closeCard(false);return;}const anchor=calMarkAnchor();/* the line moved the new event (calFollowLine, 2026-11-11): its block on the time grid comes into view once */const moved=c.lineMoved;c.lineMoved=false;if(anchor){if(moved&&anchor.closest('.time-scroll')&&!anchor.closest('.time-sticky'))anchor.scrollIntoView?.({block:'nearest'});/* and the card being typed in stays where it stands, in sight: beside the moved bar it jumped from day to day under the caret as 「다음 주 월요일」 was typed (2026-11-11 review). A hand change lets it go beside its event again (calWhenChanged) */if(c.lineHold){calPlaceCard();c.node.style.visibility='';return;}calPlaceCard(anchor.getBoundingClientRect());calCardVisibility(anchor);return;}c.node.style.visibility='';/* an older-tier event is not in the saved state: its card stays */if(c.mode!=='create'&&!c.event.history){const id=c.event.id,base=c.event.masterId||id;const day=D.localKey(c.event.start);const occurrenceGone=Boolean(c.event.masterId&&c.event.rrule)&&!eventsBetween(D.dayOffset(day,-1),D.dayOffset(day,2)).some(x=>x.id===id);if(occurrenceGone||!state.events.some(x=>x.id===id||x.id===base)){if(c.hold)return;clearTimeout(c.timer);const lost=Object.keys(c.pending||{}).length>0;calCard=null;calCardUnmount(c);if(lost)toast(tr('일정이 다른 곳에서 바뀌어 카드의 변경을 저장하지 못했어요.'),true);}}}
// The card hides while its event is scrolled out of the time grid and comes back with it (Notion).
function calCardVisibility(anchor){const c=calCard;if(!c?.node)return;/* held while the line moves its event (calCardAfterRender): the time grid's scroll does not take it to the block either */if(c.docked||c.lineHold){c.node.style.visibility='';return;}const scroller=anchor.closest('.time-scroll');if(!scroller){c.node.style.visibility='';return;}const r=anchor.getBoundingClientRect(),s=scroller.getBoundingClientRect();const top=s.top+(scroller.querySelector('.time-sticky')?.offsetHeight||0);const hidden=anchor.closest('.time-sticky')?false:r.bottom<top||r.top>s.bottom;c.node.style.visibility=hidden?'hidden':'';if(!hidden)calPlaceCard(r);}
// The colours under the dot go away on a click anywhere else, or Esc, as a menu does (2026-11-07 owner: 「빈곳이나 이런 곳 클릭하면 사라지는 게 좀 더 자연스러운 거 아닐까?」). On the click, not the press: the card below moves up, and a press would take the field from under the pointer; before the click's own work, so what it opens is placed on the settled card. No redraw: the card keeps its typing.
function calSwatchesAway(c){c.swatches=false;c.node?.querySelector('.card-swatches')?.remove();c.node?.querySelector('.card-color')?.setAttribute('aria-expanded','false');}
document.addEventListener('click',ev=>{const c=calCard;if(c?.swatches&&!ev.target?.closest?.('.card-swatches,.card-color,.color-pop'))calSwatchesAway(c);},true);
document.addEventListener('pointerdown',ev=>{const c=calCard;if(!c||!c.node)return;const t=ev.target;/* docked, its day panel is the card's sheet: the panel's own scrollbar, its padding and the space under a short card (2026-11-05 check) *//* a press beside the open month closes the month alone (datePop's mousedown, right after this) */if($('.date-pop')&&!c.node.contains(t)&&!t.closest?.('.date-pop')){calSuppressClick=performance.now()+400;return;}if(c.node.contains(t)||t.closest?.('#modal-root,.context-menu,#toast,.date-pop,.color-pop')||(c.docked&&(t.closest?.('.cal-panel-resizer')||c.node.closest('.day-panel')?.contains(t))))return;const key=t.closest?.('[data-event-key]')?.dataset.eventKey;if(key&&key===c.key)return;if(key&&key!=='draft'){if(!closeCard(true))ev.cardClosed=true;return;}ev.cardClosed=true;calSuppressClick=performance.now()+400;closeCard(true);},true);

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
    else{calCommitTyped(c);/* read as 저장 reads it: a line typed before the app closes is that day and time too (Codex full review F7) */calApplyTitle(c);if(c.v.title.trim()){c.addKey||=calNewKey();const payload=calAddPayload(c,c.v.title.trim());c.saving=true;c.savePayload=payload;tried.add(payload);const job=calSendAdd(payload,false);c.savePromise=job;
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
// ---- Keys (Notion, Google): D/W/M views, T today, J/K or ←/→ periods, C new event, / panel (2026-11-05, was \), Esc. Matched on e.code so
// they work in 한글 input mode; never while typing or with a dialog or menu open. Returns true when the key was used.
function calendarKey(e){
  if(isWidget)return false;
  if(e.type==='keydown'&&e.key!=='Tab')calKeyboardOpen=true;
  const dialog=Boolean($('#modal-root .dialog'));
  if(e.key==='Escape'&&!dialog&&!menuRoot){
    if(calGesture?.committing){e.preventDefault();return true;}
    if(calGesture){const pressed=calGesture.started;calEndGesture();if(pressed)window.addEventListener('pointerup',()=>{calSuppressClick=performance.now()+300;},{once:true,capture:true});e.preventDefault();return true;}
    if(calCard&&search&&document.activeElement?.closest?.('.search'))return false; // Esc in the search box clears the search
    if(calCard?.swatches){calSwatchesAway(calCard);calCard.node?.querySelector('.card-color')?.focus({preventScroll:true});e.preventDefault();return true;}
    if(calCard){const a=document.activeElement;if(calCard.mode!=='create'&&calCard.node&&calCard.node.contains(a)&&calFieldFocused()){a.blur();calCard?.node?.focus({preventScroll:true});}else closeCard(calCard.mode!=='create');e.preventDefault();return true;}
    if(calDrawer&&view==='calendar'){calDrawer=false;render();e.preventDefault();return true;}
  }
  // Keys wait while a drag is held, but the scope question that follows it takes the keyboard (Enter, Space, Tab).
  if(calGesture?.started&&e.key!=='Escape'&&!(calGesture.committing&&dialog)){e.preventDefault();return true;}
  if(view!=='calendar'||dialog||menuRoot||$('.date-pop')||calFieldFocused()||e.isComposing||e.altKey||e.metaKey)return false;
  if(search.trim())return false; // search results are shown in place of the calendar
  if(e.ctrlKey){if(!e.shiftKey&&(e.key==='ArrowLeft'||e.key==='ArrowRight')){e.preventDefault();calendarStep(e.key==='ArrowLeft'?-1:1);return true;}/* G as in Google Calendar (2026-11-07 owner: three keys were too many; Ctrl+K is search) */if(!e.shiftKey&&e.code==='KeyG'){e.preventDefault();calGoToDate();return true;}return false;}
  if(calCard&&calCard.node?.contains(document.activeElement))return false;
  const onCell=document.activeElement?.classList?.contains('calendar-day');
  const code=e.code;
  if(!e.shiftKey&&({KeyD:'day',KeyW:'week',KeyM:'month'})[code]){e.preventDefault();setCalMode(({KeyD:'day',KeyW:'week',KeyM:'month'})[code]);return true;}
  if(!e.shiftKey&&code==='KeyT'){e.preventDefault();goToday();return true;}
  if(!e.shiftKey&&code==='KeyG'){e.preventDefault();calGoToDate();return true;}
  if(!e.shiftKey&&(code==='KeyJ'||code==='KeyK')){e.preventDefault();calendarStep(code==='KeyK'?1:-1)/* J back, K on: J sits left of K (2026-11-06 owner) */;return true;}
  if(!e.shiftKey&&code==='KeyC'){e.preventDefault();addEvent(selectedDate);return true;}
  // / without Shift: Shift+/ is ? and opens the shortcuts in app.js (2026-11-05: the panel key moved from \ to /)
  if(code==='Slash'&&!e.shiftKey&&e.key!=='?'){e.preventDefault();calTogglePanel();return true;}
  if(!onCell&&!e.shiftKey&&(e.key==='ArrowLeft'||e.key==='ArrowRight')&&!document.activeElement?.closest?.('.sidebar,.topbar')){e.preventDefault();calendarStep(e.key==='ArrowLeft'?-1:1);return true;}
  if(!onCell&&!e.shiftKey&&calMode()==='month'&&(e.key==='ArrowUp'||e.key==='ArrowDown')&&!document.activeElement?.closest?.('.sidebar,.topbar,.day-panel')){e.preventDefault();if(!calGlide(e.key==='ArrowUp'?-1:1))calWeekStep(e.key==='ArrowUp'?-1:1);return true;}
  // The hours of the week and the day, an hour a press (2026-11-08 owner); held down it runs without the glide, which would start again on every repeat.
  if(!onCell&&!e.shiftKey&&calMode()!=='month'&&(e.key==='ArrowUp'||e.key==='ArrowDown')&&!document.activeElement?.closest?.('.sidebar,.topbar,.day-panel')){const hours=document.querySelector('#app .time-scroll');if(hours){e.preventDefault();hours.scrollBy({top:(e.key==='ArrowUp'?-1:1)*calHour,behavior:e.repeat||calReduceMotion()?'auto':'smooth'});return true;}}
  return false;
}
document.addEventListener('pointerdown',()=>{calKeyboardOpen=false;},true);

// ---- After every render: time grid size, scroll position and the current-time line; the card follows its event ----
let calObserver=null,calNowTimer=null,calNowDay=null,calResizeSig='',calResizeTimer=null;
function calendarAfterRender(){
  calCardAfterRender();calTitleFit();calTasksFit();
  /* the board drawn again under a drag (a sync, the month rolling on): the faded event, the target and the preview come back on it */if(calGesture?.started&&!calGesture.committing&&calGesture.kind.startsWith('month')){const e=calGesture.event;if(e&&!calGesture.denied)for(const n of document.querySelectorAll('#app [data-event-key="'+CSS.escape(e.id)+'"]'))n.classList.add('drag-source');calUpdateGesture();}
  const g=calGesture;if(g?.committing&&g.result){if(['move','resize-start','resize-end'].includes(g.kind))calGhost(new Date(g.result.start),new Date(g.result.end),calRangeLabel(new Date(g.result.start),new Date(g.result.end)));for(const n of document.querySelectorAll('#app [data-event-key="'+CSS.escape(g.event.id)+'"]'))n.classList.add('drag-source');}
  calResizeSig=calSignature();
  const scroller=document.querySelector('.time-scroll');
  calObserver?.disconnect();calObserver=null;
  if(!scroller){clearInterval(calNowTimer);calNowTimer=null;return;}
  const mode=calMode();const timeView=scroller.closest('.time-view');
  const fit=()=>{const sticky=scroller.querySelector('.time-sticky')?.offsetHeight||0;const next=Math.max(40,Math.round((scroller.clientHeight-sticky)/12));if(next!==calHour){const minutes=scroller.scrollTop/calHour*60;calHour=next;timeView.style.setProperty('--hour',calHour+'px');scroller.scrollTop=minutes/60*calHour;}};
  calDrawnHour=calHour;fit();if(calHour!==calDrawnHour)calRefit(true);
  calObserver=new ResizeObserver(()=>{fit();calTasksFit();if(calHour!==calDrawnHour)calRefit();});calObserver.observe(scroller);
  calTickNow();clearInterval(calNowTimer);calNowTimer=setInterval(calTickNow,30000);
  const other=mode==='week'?'day':'week';if(!calRecenter&&calScroll[mode]===null&&calScroll[other]!==null)calScroll[mode]=calScroll[other];
  if(calRecenter||calScroll[mode]===null){const sticky=scroller.querySelector('.time-sticky')?.offsetHeight||0;const viewport=scroller.clientHeight-sticky;const now=new Date();/* 오늘 and T go to the time; any other way in starts the day at 9, its label whole under the sticky head (2026-11-08 owner) */const toNow=calRecenter&&calDays().includes(D.dateKey(now));scroller.scrollTop=Math.max(0,toNow?(now.getHours()*60+now.getMinutes()-viewport/3/calHour*60)/60*calHour:9*calHour-14);calRecenter=false;calScroll[mode]=scroller.scrollTop/calHour*60;}
  else scroller.scrollTop=calScroll[mode]/60*calHour;
  scroller.addEventListener('scroll',()=>{const a=calCard&&calMarkAnchor();if(a)calCardVisibility(a);},{passive:true});
}
function calTickNow(){const view=document.querySelector('.time-view');if(!view)return;const now=new Date();const today=D.dateKey(now);if(calNowDay&&calNowDay!==today&&!calHolding()){calNowDay=today;render();return;}calNowDay=today;const minutes=now.getHours()*60+now.getMinutes();view.style.setProperty('--now',String(minutes/60));const pill=view.querySelector('.now-pill');if(pill)pill.textContent=calClock(now);for(const label of view.querySelectorAll('.hour-label'))label.classList.toggle('covered',Boolean(pill)&&Math.abs(Number(label.style.getPropertyValue('--at'))*60-minutes)/60*calHour<16);}
const calSignature=()=>{try{return view==='calendar'?calPanelDocked()+'|'+(calMode()==='month'?calMonthLimit():''):'';}catch{return '';}};
// A week or day block keeps the text rows of the hour height it was drawn with (calTimeBlock), so when fit() moves calHour — a
// resize, or the calendar shown again after the window changed on another tab — the grid is drawn once more (2026-11-02 recheck of
// app-design-2: title, time and place ran over each other there, and a 1-hour band missed 45- and 90-minute blocks). After a render
// before its first paint, keeping the slide-in of a step; after a resize 120ms past the last step; a gesture or the IME defers it.
let calDrawnHour=0,calRefitTimer=null;
function calRefit(soon){clearTimeout(calRefitTimer);calRefitTimer=null;const go=()=>{calRefitTimer=null;try{if(isWidget||!state||view!=='calendar'||calHour===calDrawnHour)return;const tv=document.querySelector('#app .time-view');if(!tv)return;if(soon)calSlide=tv.classList.contains('slide-next')?1:tv.classList.contains('slide-prev')?-1:0;render();}catch{}};if(soon)requestAnimationFrame(go);else calRefitTimer=setTimeout(go,120);}
window.addEventListener('resize',()=>{clearTimeout(calResizeTimer);calResizeTimer=setTimeout(()=>{try{if(isWidget||!state||view!=='calendar'||calHolding())return;if(calSignature()!==calResizeSig)render();else{if(calCard)calCardAfterRender();calTitleFit();}}catch{}},120);});
document.addEventListener('visibilitychange',()=>{try{if(!document.hidden&&!isWidget)calTickNow();}catch{}});
