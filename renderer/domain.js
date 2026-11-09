(function(root){
  const pad = x=>String(x).padStart(2,'0');
  const dateKey = (d=new Date())=>`${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
  const eventDate = event=>event.allDay?event.start.slice(0,10):dateKey(new Date(event.start));
  const fromDate = s=>new Date(`${s}T12:00:00`);
  const dayOffset = (s,days)=>{ const d=fromDate(s);d.setDate(d.getDate()+days);return dateKey(d); };
  function inDay(event,day){
    if(event.allDay){const start=event.start.slice(0,10);const end=event.end?.slice(0,10)||dayOffset(start,1);return day>=start&&day<end;}
    const start=new Date(event.start),end=new Date(event.end||event.start);
    const a=new Date(`${day}T00:00:00`),b=new Date(a);b.setDate(b.getDate()+1);
    return start<b && (end>start ? end>a : start>=a);
  }
  // A subtask's date counts for its task (2026-11-07 owner: a task due the 30th with steps due the 15th, 19th and 29th): the earliest of its own date
  // and its open steps' is when it next needs looking at, in 오늘, 예정 and the sort by date.
  // A time range's dash (2026-11-08 owner: 「오후 8:00-오후 9:00 … 반칸씩이라도 띄우는 게」): an en dash between thin spaces, as Apple's date ranges set it.
  const RANGE='\u2009–\u2009';
  function nextDueOf(t){let next=t.dueDate||'';for(const x of Array.isArray(t.steps)?t.steps:[])if(x.dueDate&&!x.completed&&(!next||x.dueDate<next))next=x.dueDate;return next;}
  // The open steps of open tasks due on a day, for the calendar.
  function stepsDueOn(tasks,day){const out=[];for(const t of tasks||[]){if(t.completed||!Array.isArray(t.steps))continue;for(const x of t.steps)if(x.dueDate===day&&!x.completed)out.push({task:t,step:x});}return out;}
  function matches(t,view,today=dateKey()){
    if(view==='today'){const next=nextDueOf(t);return !!next&&next<=today;}
    if(view==='planned')return !!nextDueOf(t);
    if(view==='important')return t.important;
    if(view==='all')return true;
    return t.listId===view;
  }
  function monthCells(date){const year=date.getFullYear(),month=date.getMonth(); const start=new Date(year,month,1);start.setDate(1-start.getDay());return Array.from({length:42},(_,i)=>{const d=new Date(start);d.setDate(start.getDate()+i);return {key:dateKey(d),day:d.getDate(),outside:d.getMonth()!==month};});}
  // List appearance shared by main (validation) and the renderer (drawing).
  const LIST_ICONS=['list','flag','star','cart','home','briefcase','book','heart','gift','plane','bulb','coffee','mail','sun','calendar','note'];
  const LIST_PALETTE=['#ff3b30','#ff9500','#ffcc00','#34c759','#30b0c7','#007aff','#5856d6','#af52de','#ff2d55','#a2845e','#8e8e93'];
  const AUTO_PALETTE=['#007aff','#ff9500','#34c759','#af52de','#ff2d55','#30b0c7','#5856d6','#ff3b30','#a2845e'];
  // Smallest widget windows that still show their content (calendar: header + 6-week grid). main clamps a widget to it (the
  // window's minimum, widget:resize) and the widget's own resize handle stops there (2026-10-27 review: the two copies had to match).
  // The calendar's docked right panel at a width the user dragged its edge to (2026-10-29 owner: 「작은 창으로 달력 기능을 봤을 때 여전히
  // 오른쪽 탭이 크지 않아? 이거 원하면 분계선 선을 잡고 원하는 크기 만큼 좁히거나」): px, or null for the width that follows the window
  // (styles.css .calendar-view). Narrower than 220 the day's heading and its + no longer fit; wider than 480 it is no longer a side panel.
  const CAL_PANEL_WIDTH={min:220,max:480};
  // Where questions go (2026-10-30 owner: 「nowsummer.apps@gmail.com 이걸로 새로운 이메일 하나 만들었어. 설정이나 적절한 곳에 문의 있으면 여기로
  // 연락하라고 짤막하게 적어놔줘」): Dayboard's own address, public on purpose — settings shows it, main opens mail to it and nowhere else
  // (external:open), scripts/public-text-rules.cjs lets this one address through.
  const CONTACT_EMAIL='nowsummer.apps@gmail.com';
  // Connected calendars in two tiers (2026-10-30 owner chose 「달력 5년 기록 2단 방식」, agreed 2026-10-28: widening the one window to five
  // years made every edit two to three times slower, as each save writes the whole state and sends it to every window). The recent
  // window — a year back to a year ahead — is synced every five minutes into the saved state, as before; the years before it, back
  // to five years from today, are fetched once a day into files of their own (lib/calhistory.cjs) and read only when an old month or
  // a search needs them. One reckoning for the providers (common.dateRange), main and the screen.
  const SYNC_MONTHS=12,HISTORY_MONTHS=60,HISTORY_OVERLAP_DAYS=31;
  function syncWindow(now=new Date()){
    const start=new Date(now);start.setMonth(start.getMonth()-SYNC_MONTHS);start.setHours(0,0,0,0);
    const end=new Date(now);end.setMonth(end.getMonth()+SYNC_MONTHS);end.setHours(23,59,59,999);
    return {start:start.toISOString(),end:end.toISOString()};
  }
  // The older tier: five years back from today, up to a month into the recent window — the recent window's start moves a day
  // each day while the history is fetched once a day, so the overlap leaves no gap (the same event in both is shown once, by id).
  function historyWindow(now=new Date()){
    const start=new Date(now);start.setMonth(start.getMonth()-HISTORY_MONTHS);start.setHours(0,0,0,0);
    const end=new Date(syncWindow(now).start);end.setDate(end.getDate()+HISTORY_OVERLAP_DAYS);
    return {start:start.toISOString(),end:end.toISOString()};
  }
  // That window in pieces of twelve months, one request each, oldest first; the last piece ends with the window.
  function historyChunks(window){
    const out=[];const end=Date.parse(window.end);let from=new Date(window.start);
    while(from.getTime()<end){const to=new Date(from);to.setMonth(to.getMonth()+12);out.push({start:from.toISOString(),end:new Date(Math.min(to.getTime(),end)).toISOString()});from=to;}
    return out;
  }
  const panelWidth=v=>v==null?null:Number.isFinite(v)?Math.round(Math.min(CAL_PANEL_WIDTH.max,Math.max(CAL_PANEL_WIDTH.min,v))):undefined;
  // A sheet's overlay scroll thumb (2026-10-30 owner: 「설정 창에서 스크롤이 너무 완성도가 낮게 디자인 되어 있는데 수정해줘. 애플 최신
  // 디자인 컨셉에 맞고」, app.js sheetScroll): it runs between the pinned header and footer, `inset` px clear of both (the system bar
  // ran the sheet's whole height, into the rounded corners and past the 닫기 bar), and its length is the part of the scrolling
  // body in view. view/content: the sheet's clientHeight/scrollHeight, top: its scrollTop, head/foot: the pinned bars' heights.
  // A sheet too short to keep that track uses its whole height. null when nothing scrolls. per: scroll px per px of dragging.
  function scrollThumb({view,content,top=0,head=0,foot=0,inset=6,min=32}){
    const range=content-view;
    if(!(view>0)||!(range>=1))return null;
    let start=head+inset,end=view-foot-inset;
    if(end-start<min*2){start=inset;end=view-inset;}
    const track=end-start;
    if(track<min)return null;
    const seen=Math.max(1,view-head-foot);
    const length=Math.min(track,Math.max(min,Math.round(track*seen/(seen+range))));
    const at=Math.min(1,Math.max(0,top/range));
    return {top:Math.round(start+(track-length)*at),length,start,track,range,per:track>length?range/(track-length):0};
  }
  const WIDGET_MIN={calendar:{minWidth:300,minHeight:360},tasks:{minWidth:280,minHeight:240},note:{minWidth:280,minHeight:220}};
  // 글자 크기 (2026-11-02 owner: text size — the main monitor went from Windows 125% to 100%, so everything looks a fifth smaller): three
  // steps, as macOS Text Size and iOS Dynamic Type, whose +2pt steps from the 17pt body are about +12% and +24%. One per PC for the main
  // window (settings.textSize, Chromium zoom) and one for every widget (settings.widgetTextSize, CSS zoom on the card's content). Never
  // below the default: nothing under 12px (owner's rule). One table for main, the store and the renderer.
  const TEXT_SIZES=Object.freeze({default:1,large:1.125,larger:1.25});
  const TEXT_SIZE_STEPS=Object.freeze(Object.keys(TEXT_SIZES));
  // The factor of a stored value (anything else is the default's 1); a step (+1 larger, −1 smaller) from a value, held at the ends.
  const textScale=size=>typeof size==='string'&&Object.hasOwn(TEXT_SIZES,size)?TEXT_SIZES[size]:1;
  const textSizeStep=(size,step)=>{const i=Math.max(0,TEXT_SIZE_STEPS.indexOf(size));return TEXT_SIZE_STEPS[Math.min(TEXT_SIZE_STEPS.length-1,Math.max(0,i+Math.sign(step||0)))];};
  // The size a new widget opens at (main.cjs openWidget).
  const WIDGET_OPEN={calendar:{width:360,height:440},tasks:{width:360,height:450},note:{width:360,height:330}};
  // A widget's smallest card at a widget text size (r60-X): WIDGET_MIN grows with the factor, so the smallest card shows at 크게 and 더 크게
  // what it shows at 기본 (at 더 크게 a 280×240 to-do card had no whole row: its first title took three lines) — never past the size a new
  // card opens at, so a widget of that size never grows. One rule for main (window minimum, resize, display changes) and the resize grip.
  function widgetMinimum(type,size){const m=WIDGET_MIN[type]||WIDGET_MIN.note,o=WIDGET_OPEN[type]||WIDGET_OPEN.note,f=textScale(size);return {minWidth:Math.min(o.width,Math.round(m.minWidth*f)),minHeight:Math.min(o.height,Math.round(m.minHeight*f))};}
  const EMOJI_PREFIX=/^((?:\p{Extended_Pictographic}|\p{Regional_Indicator}{2})(?:️|\p{Emoji_Modifier})?(?:‍\p{Extended_Pictographic}(?:️|\p{Emoji_Modifier})?)*)\s*/u;
  // "🛒 쇼핑" → the emoji becomes the list symbol and the title loses it (Windows To Do habit).
  function splitEmoji(name){const text=String(name||'').trim();const m=text.match(EMOJI_PREFIX);if(!m)return {emoji:'',title:text};const title=text.slice(m[0].length).trim();return title?{emoji:m[1],title}:{emoji:'',title:text};}
  // Stable colour for lists whose provider has no colour (Microsoft, Google).
  function autoColor(id){let hash=0;for(const ch of String(id||''))hash=(hash*31+ch.codePointAt(0))>>>0;return AUTO_PALETTE[hash%AUTO_PALETTE.length];}
  // ---- Recurrence: the RFC 5545 RRULE subset that Apple Calendar's repeat sheet produces ----
  // FREQ=DAILY|WEEKLY|MONTHLY|YEARLY, INTERVAL, BYDAY (weekly days, monthly "2TU"/"-1FR"), BYMONTHDAY,
  // COUNT or UNTIL, WKST. Anything else is refused by parseRRule so an unsupported rule is never
  // expanded wrongly. Occurrences keep the master's local wall-clock time and duration.
  const RRULE_DAYS=['SU','MO','TU','WE','TH','FR','SA'];
  function parseRRule(text){
    if(typeof text!=='string'||!text.trim()||text.length>300)return null;
    const rule={freq:'',interval:1,byDay:[],byMonthDay:null,count:null,until:null,wkst:1};
    for(const part of text.trim().replace(/^RRULE:/i,'').split(';')){
      if(!part)continue;
      const eq=part.indexOf('=');if(eq<0)return null;
      const key=part.slice(0,eq).trim().toUpperCase(),value=part.slice(eq+1).trim().toUpperCase();
      if(key==='FREQ'){if(!['DAILY','WEEKLY','MONTHLY','YEARLY'].includes(value))return null;rule.freq=value;}
      else if(key==='INTERVAL'){if(!/^\d{1,3}$/.test(value)||Number(value)<1)return null;rule.interval=Number(value);}
      else if(key==='COUNT'){if(!/^\d{1,4}$/.test(value)||Number(value)<1)return null;rule.count=Number(value);}
      else if(key==='UNTIL'){if(!/^\d{8}(T\d{6}Z?)?$/.test(value))return null;rule.until=value;}
      else if(key==='WKST'){const i=RRULE_DAYS.indexOf(value);if(i<0)return null;rule.wkst=i;}
      else if(key==='BYDAY'){for(const item of value.split(',')){const m=item.match(/^([+-]?[1-5])?(SU|MO|TU|WE|TH|FR|SA)$/);if(!m)return null;rule.byDay.push({ord:m[1]?Number(m[1]):0,day:RRULE_DAYS.indexOf(m[2])});}}
      else if(key==='BYMONTHDAY'){if(!/^-?\d{1,2}$/.test(value)||Number(value)===0||Math.abs(Number(value))>31)return null;rule.byMonthDay=Number(value);}
      else return null;
    }
    if(!rule.freq||(rule.count&&rule.until))return null;
    if(rule.byDay.length>7)return null;
    return rule;
  }
  function buildRRule(rule){
    const parts=['FREQ='+rule.freq];
    if(rule.interval>1)parts.push('INTERVAL='+rule.interval);
    if(rule.byDay?.length)parts.push('BYDAY='+rule.byDay.map(d=>(d.ord?d.ord:'')+RRULE_DAYS[d.day]).join(','));
    if(rule.byMonthDay)parts.push('BYMONTHDAY='+rule.byMonthDay);
    if(rule.count)parts.push('COUNT='+rule.count);
    if(rule.until)parts.push('UNTIL='+rule.until);
    if(rule.wkst!==undefined&&rule.wkst!==1)parts.push('WKST='+RRULE_DAYS[rule.wkst]);
    return parts.join(';');
  }
  const startOfLocalDay=key=>new Date(`${key}T00:00:00`);
  const daysInMonth=(y,m)=>new Date(y,m+1,0).getDate();
  function untilBound(until,allDay){
    const y=+until.slice(0,4),m=+until.slice(4,6)-1,d=+until.slice(6,8);
    if(until.length===8||allDay)return new Date(y,m,d,23,59,59,999);
    const hh=+until.slice(9,11),mm=+until.slice(11,13),ss=+until.slice(13,15);
    return until.endsWith('Z')?new Date(Date.UTC(y,m,d,hh,mm,ss)):new Date(y,m,d,hh,mm,ss);
  }
  // UNTIL text for "end before this occurrence": the day before for all-day series, one second before for timed ones (UTC).
  function untilBefore(occurrenceStart,allDay){
    if(allDay)return dayOffset(occurrenceStart.slice(0,10),-1).replace(/-/g,'');
    return new Date(new Date(occurrenceStart).getTime()-1000).toISOString().replace(/[-:]|\.\d{3}/g,'');
  }
  function nthWeekday(year,month,day,ord){
    const dim=daysInMonth(year,month);
    if(ord>0){const offset=(day-new Date(year,month,1).getDay()+7)%7;const date=1+offset+(ord-1)*7;return date<=dim?date:null;}
    const offset=(new Date(year,month,dim).getDay()-day+7)%7;const date=dim-offset+(ord+1)*7;return date>=1?date:null;
  }
  // Whole local days from the day of `a` to the day of `b` (noon to noon, so a clock change never counts as a day).
  const dayGapOf=(a,b)=>Math.round((fromDate(dateKey(b))-fromDate(dateKey(a)))/86400000);
  // Walks the recurrence set in order and calls visit(startDate, index) for every generated instance
  // (EXDATEs included, as COUNT counts them). visit returns false to stop. Capped so a rule can never spin forever: returns
  // false when the cap stopped the walk before the rule or the visitor did, true otherwise (2026-10-28 Codex review R7:
  // 6,000 steps counted from the series' start ended a daily series after 16 years, and a capped walk looked like one that
  // had ended). `from` (a Date): the walk starts just before it instead of at the series' start when the number of instances
  // before it is known exactly — daily and weekly rules by arithmetic, monthly and yearly ones whose date every month or year
  // has — so the index is still the instance's place in the series and COUNT and UNTIL still end it where they did. The
  // 29th–31st, the 5th weekday, 29 February and monthly rules by weekdays walk from the start (a dozen steps a year).
  function walkRRule(event,visit,from){
    const rule=parseRRule(event.rrule);if(!rule)return true;
    const allDay=Boolean(event.allDay);
    const base=allDay?startOfLocalDay(String(event.start).slice(0,10)):new Date(event.start);
    if(!Number.isFinite(base.getTime()))return true;
    const until=rule.until?untilBound(rule.until,allDay):null;
    const at=(y,m,d)=>new Date(y,m,d,base.getHours(),base.getMinutes(),base.getSeconds(),base.getMilliseconds());
    const skipTo=from instanceof Date&&from>base?from:null;
    let produced=0,steps=0;const LIMIT=50000;
    const consider=o=>{
      if(o<base)return true;
      produced++;
      if(rule.count&&produced>rule.count)return false;
      if(until&&o>until)return false;
      return visit(o,produced-1)!==false;
    };
    // Instances the first period generates before the series' own start are not counted (consider skips them).
    const lead=candidates=>candidates.filter(o=>o<base).length;
    const by=base.getFullYear(),bm=base.getMonth(),bd=base.getDate();
    if(rule.freq==='DAILY'){
      let i=0;
      if(skipTo){i=Math.max(0,Math.ceil(dayGapOf(base,skipTo)/rule.interval)-1);produced=i?i-lead([at(by,bm,bd)]):0;}
      for(;steps++<LIMIT;i++){if(!consider(at(by,bm,bd+i*rule.interval)))return true;}
    }
    else if(rule.freq==='WEEKLY'){
      const days=(rule.byDay.length?rule.byDay.map(d=>d.day):[base.getDay()]).filter((d,i,a)=>a.indexOf(d)===i).sort((a,b)=>((a-rule.wkst+7)%7)-((b-rule.wkst+7)%7));
      const weekStart=new Date(by,bm,bd-((base.getDay()-rule.wkst+7)%7));
      const inWeek=(w,d)=>at(weekStart.getFullYear(),weekStart.getMonth(),weekStart.getDate()+w*7*rule.interval+((d-rule.wkst+7)%7));
      let w=0;
      if(skipTo){w=Math.max(0,Math.floor(dayGapOf(weekStart,skipTo)/(7*rule.interval))-1);produced=w?w*days.length-lead(days.map(d=>inWeek(0,d))):0;}
      for(;steps++<LIMIT;w++)for(const d of days){if(!consider(inWeek(w,d)))return true;}
    }
    else if(rule.freq==='MONTHLY'){
      const ordinal=rule.byDay.find(d=>d.ord)||null;const weekdays=rule.byDay.filter(d=>!d.ord).map(d=>d.day);const mday=rule.byMonthDay||base.getDate();
      const datesIn=(y,m)=>{
        const dim=daysInMonth(y,m);
        if(ordinal){const d=nthWeekday(y,m,ordinal.day,ordinal.ord);return d?[d]:[];}
        if(weekdays.length){const dates=[];for(let d=1;d<=dim;d++)if(weekdays.includes(new Date(y,m,d).getDay()))dates.push(d);return dates;}
        const d=mday>0?mday:dim+mday+1;return d>=1&&d<=dim?[d]:[];
      };
      // Every month has its 1st–28th, its last 28 days and the 1st–4th weekday from either end: one instance a month, counted exactly.
      const steady=ordinal?Math.abs(ordinal.ord)<=4:!weekdays.length&&Math.abs(mday)<=28;
      let k=0;
      if(skipTo&&steady){k=Math.max(0,Math.floor(((skipTo.getFullYear()-by)*12+skipTo.getMonth()-bm)/rule.interval)-1);produced=k?k-lead(datesIn(by,bm).map(d=>at(by,bm,d))):0;}
      // The calendar repeats every 400 years (4,800 months, weekdays too), so the months a rule visits repeat every `cycle` of its
      // steps: a whole cycle without its date (the 30th every 12 months from February) means it has none, and it has ended. A
      // month past UNTIL ends it as its dates would (2026-10-28 recheck of Codex review R7: such a rule walked to the cap on
      // every expansion).
      const gcd=(a,b)=>b?gcd(b,a%b):a;const cycle=4800/gcd(rule.interval,4800);let empty=0;
      for(;steps++<LIMIT;k++){
        const first=new Date(by,bm+k*rule.interval,1);if(until&&first>until)return true;
        const y=first.getFullYear(),m=first.getMonth(),dates=datesIn(y,m);
        if(!dates.length){if(++empty>=cycle)return true;continue;}
        empty=0;for(const d of dates){if(!consider(at(y,m,d)))return true;}
      }
    }
    else{
      let k=0;
      if(skipTo&&!(bm===1&&bd===29)){k=Math.max(0,Math.floor((skipTo.getFullYear()-by)/rule.interval)-1);produced=k?k-lead([at(by,bm,bd)]):0;}
      for(;steps++<LIMIT;k++){const y=by+k*rule.interval;if(bd>daysInMonth(y,bm))continue;if(!consider(at(y,bm,bd)))return true;}
    }
    return false;
  }
  // Occurrences of a recurring master that touch [fromKey, toKey). Each occurrence is a full event object
  // whose id is "<masterId>@<recurrenceId>" so the UI can address one instance, with masterId/recurrenceId set.
  // `limit` stops after that many (firstOccurrence).
  function expandEvent(event,fromKey,toKey,limit=0){
    const allDay=Boolean(event.allDay);
    const base=allDay?startOfLocalDay(String(event.start).slice(0,10)):new Date(event.start);
    if(!Number.isFinite(base.getTime()))return [];
    const endBase=allDay?startOfLocalDay(String(event.end||'').slice(0,10)||dayOffset(String(event.start).slice(0,10),1)):new Date(event.end||event.start);
    const span=allDay?Math.max(1,Math.round((endBase-base)/86400000)):Math.max(0,endBase-base);
    const rangeStart=startOfLocalDay(fromKey).getTime(),rangeEnd=startOfLocalDay(toKey).getTime();
    const exdates=new Set(event.exdates||[]);
    const out=[];
    // The walk may start just before the range less the occurrences' length: one that begins earlier can still reach into it.
    const complete=walkRRule(event,o=>{
      const startMs=o.getTime();if(startMs>=rangeEnd)return false;
      const endMs=allDay?startMs+span*86400000:startMs+span;
      const visible=endMs>startMs?endMs>rangeStart:startMs>=rangeStart;
      if(!visible)return true;
      const recurrenceId=allDay?dateKey(o):o.toISOString();
      if(exdates.has(recurrenceId)||exdates.has(dateKey(o)))return true;
      const start=allDay?recurrenceId:o.toISOString();
      const end=allDay?dayOffset(recurrenceId,span):new Date(endMs).toISOString();
      out.push({...event,id:`${event.id}@${recurrenceId}`,masterId:event.id,recurrenceId,start,end,occurrence:true});
      return !limit||out.length<limit;
    },new Date(rangeStart-(allDay?span*86400000:span)));
    // The cap stopped the walk short of the range (no rule Dayboard writes gets there; see walkRRule): occurrences may be
    // missing, which a caller can tell from a series that has ended (2026-10-28 Codex review R7).
    if(!complete)out.incomplete=true;
    return out;
  }
  // Position of one occurrence inside its series: how many instances come before it, and how many COUNT leaves after it.
  function seriesPosition(event,recurrenceId){
    const rule=parseRRule(event.rrule);if(!rule)return null;
    const key=String(recurrenceId).slice(0,10);const target=event.allDay?startOfLocalDay(key):new Date(recurrenceId);
    if(!Number.isFinite(target.getTime()))return null;
    let found=null;
    // The walk starts just before the instance looked for (its place is counted exactly; see walkRRule) and stops once past it,
    // bounded only by walkRRule's cap (2026-10-28 recheck of Codex review R7: a guard of 20,000 instances stopped it at its
    // first step for a daily series of 55 years, and main's 「이후 모든 일정」 then changed the whole series).
    walkRRule(event,(o,index)=>{const rid=event.allDay?dateKey(o):o.toISOString();if(rid===recurrenceId||(event.allDay&&rid===key)){found={index,remaining:rule.count?rule.count-index:null};return false;}return event.allDay?rid<key:o<=target;},target);
    return found;
  }
  // A series' first occurrence (excluded dates skipped), walked only to it; null when it has none. The calendar search lists it for
  // a series begun outside its window, so a series of any year is found (2026-10-28, area J).
  function firstOccurrence(event){return expandEvent(event,localKey(event.start),'9999-12-31',1)[0]||null;}
  function touchesRange(e,fromKey,toKey){
    if(e.allDay){const s=String(e.start).slice(0,10),en=String(e.end||'').slice(0,10)||dayOffset(s,1);return s<toKey&&en>fromKey;}
    const s=new Date(e.start),en=new Date(e.end||e.start),a=startOfLocalDay(fromKey),b=startOfLocalDay(toKey);
    return s<b&&(en>s?en>a:s>=a);
  }
  // Everything to draw between two day keys: plain events and exceptions as stored, recurring masters expanded.
  function eventsInRange(events,fromKey,toKey){
    const out=[];
    for(const e of events){if(e.rrule){const part=expandEvent(e,fromKey,toKey);if(part.incomplete)out.incomplete=true;out.push(...part);}else if(touchesRange(e,fromKey,toKey))out.push(e);}
    return out;
  }
  // ---- Calendars: where new events go, and when the local calendar steps back ----
  const calendarWritable=c=>Boolean(c)&&!c.readOnly;
  // Calendar for a new event: the user's choice while it exists and is writable, else the connected account's
  // primary calendar (Google primary / Outlook default calendar), else any writable account calendar, else this PC.
  // Connected accounts in the order they were connected (state.accounts), then any other, then this PC. The automatic list and
  // calendar follow it: by place in state.lists/calendars they moved to the other account each time a sync re-read one
  // account (2026-10-27 check).
  function accountRank(accounts){
    const order=new Map((accounts||[]).map((a,i)=>[a.id,i]));
    return item=>item?.provider==='local'?2e9:order.has(item?.accountId)?order.get(item.accountId):1e9;
  }
  const byRank=(items,rank)=>items.map((item,i)=>[item,i]).sort((a,b)=>rank(a[0])-rank(b[0])||a[1]-b[1]).map(([item])=>item);
  // A list a new task can go to: not Outlook's flagged-mail list, which only gathers flagged mail (its archive copy can).
  function taskList(list){return Boolean(list)&&!(list.kind==='flaggedEmails'&&list.provider==='microsoft');}
  // Where a new task goes when no list is chosen: the To Do 「Tasks」 list of the first Microsoft account, else this PC's
  // first list, else the first list that can hold tasks.
  function autoListId(lists,accounts){
    const all=lists||[];
    const microsoft=byRank(all.filter(l=>l.kind==='defaultList'&&l.provider==='microsoft'),accountRank(accounts))[0];
    return (microsoft||all.find(l=>l.provider==='local')||all.find(taskList))?.id||null;
  }
  // How many connected accounts hold these lists or calendars (this PC not counted).
  function accountCount(items){return new Set((items||[]).filter(i=>i.provider!=='local').map(i=>String(i.accountId||i.provider))).size;}
  function defaultCalendarId(state){
    const calendars=state.calendars||[];
    const chosen=calendars.find(c=>c.id===state.settings?.defaultCalendarId);
    if(calendarWritable(chosen))return chosen.id;
    const writable=byRank(calendars.filter(c=>c.provider!=='local'&&calendarWritable(c)),accountRank(state.accounts));
    const account=writable.find(c=>c.primary)||writable[0];
    if(account)return account.id;
    return (calendars.find(c=>c.id==='local-calendar')||calendars.find(c=>c.provider==='local'))?.id||'local-calendar';
  }
  // Apple Calendar's "On My Mac" rule: once an account calendar can hold events, the empty local calendar
  // is not listed. It returns as soon as it holds an event again.
  // Sidebar sections group lists by where they live: this PC, or one connected account.
  function sectionKey(list){
    if(!list)return '';
    return list.provider==='local'?'local':String(list.accountId||list.provider||'');
  }
  // The sidebar's order of lists: the place in settings.listOrder, then the order the lists come in. One function for the screen
  // (app.js orderedLists) and lib/viewsync.cjs, which lays a list order synced from another PC into this PC's slots (2026-10-29).
  function orderLists(lists,listOrder){const idx=new Map((listOrder||[]).map((id,i)=>[id,i]));const from=new Map((lists||[]).map((l,i)=>[l,i]));return [...(lists||[])].sort((a,b)=>((idx.get(a.id)??1e9)-(idx.get(b.id)??1e9))||(from.get(a)-from.get(b)));}
  // Lists a service keeps for itself: Microsoft To Do's 「Tasks」 and 「Flagged email」 (Graph: built-in lists
  // "cannot be renamed or deleted"), Google Tasks' default list (marked defaultList by the Google provider) and
  // this PC's inbox. They can be hidden from Dayboard, not deleted. Returns the reason ('' for an ordinary list).
  function builtInList(list){
    if(!list)return '';
    if(list.provider==='local')return list.id==='local-inbox'?'inbox':'';
    return list.kind==='defaultList'||list.kind==='flaggedEmails'?list.kind:'';
  }
  // The state the screens use: lists and tasks of hidden sections (settings.hiddenSections) and of hidden
  // lists (settings.hiddenLists) are left out everywhere (sidebar, smart lists, search, widgets, reminders).
  // allLists keeps every list for the settings dialog. Hiding everything is ignored rather than showing nothing.
  function visibleState(state){
    const settings=(state&&state.settings)||{};
    const hidden=new Set(settings.hiddenSections||[]);
    const hiddenIds=new Set(settings.hiddenLists||[]);
    const lists=(state&&state.lists)||[];
    if(!hidden.size&&!hiddenIds.size)return Object.assign({},state,{allLists:lists});
    const isHidden=l=>hidden.has(sectionKey(l))||hiddenIds.has(l.id);
    const shown=lists.filter(l=>!isHidden(l));
    if(!shown.length)return Object.assign({},state,{allLists:lists});
    const gone=new Set(lists.filter(isHidden).map(l=>l.id));
    return Object.assign({},state,{allLists:lists,lists:shown,tasks:(state.tasks||[]).filter(t=>!gone.has(t.listId))});
  }
  // settings:update guard: '' when the save may go through, 'lists' or 'sections' (which kind of newly hidden
  // item hides the last visible list). A save that hides nothing new always goes through, even if every list
  // is already hidden (a delete or a sync can cause that; keepOneVisible repairs it).
  function hidingRefusal(before,next,lists){
    const newSections=(next.hiddenSections||[]).filter(k=>!(before.hiddenSections||[]).includes(k));
    const newLists=(next.hiddenLists||[]).filter(id=>!(before.hiddenLists||[]).includes(id));
    if(!(newSections.length||newLists.length)||!lists||!lists.length)return '';
    const sections=new Set(next.hiddenSections||[]),ids=new Set(next.hiddenLists||[]);
    return lists.every(l=>sections.has(sectionKey(l))||ids.has(l.id))?(newLists.length?'lists':'sections'):'';
  }
  // When every list is hidden (a delete, a disconnect or a sync removed the last visible one), show one again —
  // 「내 할 일」 if it exists — by un-hiding only its section and its own id; every other hide choice stays.
  // Mutates state.settings; returns true when something changed. Used by main (list:delete) and lib/sync.cjs.
  function keepOneVisible(state){
    const lists=(state&&state.lists)||[];const settings=state&&state.settings;if(!settings||!lists.length)return false;
    const sections=new Set(settings.hiddenSections||[]),ids=new Set(settings.hiddenLists||[]);
    if(lists.some(l=>!sections.has(sectionKey(l))&&!ids.has(l.id)))return false;
    const pick=lists.find(l=>l.id==='local-inbox')||lists[0];
    settings.hiddenSections=(settings.hiddenSections||[]).filter(key=>key!==sectionKey(pick));
    settings.hiddenLists=(settings.hiddenLists||[]).filter(id=>id!==pick.id);
    return true;
  }
  // Widget glass strength, settings.glassLevel: 0 = clear … 1 = frosted (like iOS 26's Liquid Glass Clear/Tinted).
  // L is the measured luminance (0–1) of the wallpaper behind the card, or null when none is painted.
  // Returns the white tint of light cards (a), the dark tint of dark cards (da), blur (px), saturation (%) and
  // the solid alpha used without a wallpaper (always-on-top widgets). Liquid Glass (2026-10-21 user request): less
  // frost and tint than the 2026-10-20 look so the wallpaper shows through the bent rim (renderer/glass.js applies
  // the tint before the saturation, dsat for dark glass, and blurs the lens with half of `blur` so the bent wallpaper
  // stays crisp enough to read as glass; the CSS fallback uses the full value); every level keeps text readable because
  // the tint is solved from the wallpaper's brightness (the caller passes the darker tail of the wallpaper for light
  // glass, the brighter tail for dark glass): light glass ends at luma >= .7 for dark text, dark glass darkens at
  // least 40% toward slate. 2026-10-21 review: floors raised after measured contrast on blue and two-tone wallpapers.
  function glassTint(level,L){
    const g=typeof level==='number'&&Number.isFinite(level)?Math.min(1,Math.max(0,level)):0.5;
    const mix=(clear,mid,frost)=>g<=0.5?clear+(mid-clear)*(g/0.5):mid+(frost-mid)*((g-0.5)/0.5);
    const clamp=(v,lo,hi)=>Math.min(hi,Math.max(lo,v));
    // At the opaque end the glass is gone: a plain solid card in the app's own theme, as the first widgets were (2026-10-26 user:
    // 「불투명 끝단으로 가서 아예 없어지면 처음 너가 만들어준 위젯처럼 되어야 하는 거 아닐까?」).
    const out={blur:Math.round(mix(7,13,24)),sat:Math.round(mix(220,200,160)),dsat:Math.round(mix(160,150,135)),alpha:+mix(0.78,0.94,1).toFixed(3),solid:g>=0.995};
    if(typeof L!=='number'||!Number.isFinite(L))return out;
    const target=mix(0.7,0.8,0.93),lo=mix(0.15,0.32,0.75),hi=mix(0.7,0.82,0.95);
    out.a=+clamp((target-L)/Math.max(0.05,1-L),lo,hi).toFixed(3);
    const dark=mix(0.38,0.24,0.15),dlo=mix(0.4,0.45,0.7),dhi=mix(0.72,0.84,0.92);
    out.da=+clamp(L>dark?(L-dark)/Math.max(0.05,L-0.12):dlo,dlo,dhi).toFixed(3);
    return out;
  }
  // A colour of one's own (2026-11-03 owner: 「할 일 목록이나 달력 등에서 색상 선택 시에 이런식으로 다양한 색상을 선택할 수 있는 팔레트를 주는거도
  // 좋지 않을까?」), from the system colour picker of the 「다른 색…」 swatch: kept at most as light as the palette's lightest (노랑 #ffcc00) — a
  // lighter one vanishes as a title, an icon circle or an event bar on the light theme's white — and at least 1.5:1 from the dark theme's page
  // (#24262b), so it still shows there as a mark. Deep colours (navy, forest green, burgundy) stay as chosen. A colour out of that band moves
  // toward black or white in 1% steps until it is in, keeping its hue; the result is what is saved (lib/validate.cjs takes any #rrggbb).
  const lumOfHex=c=>{const n=parseInt(c.slice(1),16),lin=v=>{v/=255;return v<=0.04045?v/12.92:((v+0.055)/1.055)**2.4;};return 0.2126*lin(n>>16&255)+0.7152*lin(n>>8&255)+0.0722*lin(n&255);};
  const CUSTOM_LUM_MAX=lumOfHex('#ffcc00'),CUSTOM_LUM_MIN=1.5*(lumOfHex('#24262b')+0.05)-0.05;
  const isCustomColor=c=>/^#[0-9a-f]{6}$/i.test(c||'')&&!LIST_PALETTE.includes(String(c).toLowerCase());
  // A colour as hue 0–360, saturation and brightness 0–1 and back, for the 「다른 색…」 popover (app.js chooseColor).
  function hexToHsv(hex){const n=parseInt(hex.slice(1),16),r=(n>>16&255)/255,g=(n>>8&255)/255,b=(n&255)/255,max=Math.max(r,g,b),d=max-Math.min(r,g,b);let hue=0;if(d)hue=60*(max===r?((g-b)/d+6)%6:max===g?(b-r)/d+2:(r-g)/d+4);return [hue,max?d/max:0,max];}
  function hsvToHex(hue,sat,val){const part=n=>{const k=(n+hue/60)%6;return Math.round(255*(val-val*sat*Math.max(0,Math.min(k,4-k,1)))).toString(16).padStart(2,'0');};return '#'+part(5)+part(3)+part(1);}
  function clampColor(color){
    if(!/^#[0-9a-f]{6}$/i.test(color||''))return null;
    const hex=color.toLowerCase(),inBand=x=>{const l=lumOfHex(x);return l>=CUSTOM_LUM_MIN-1e-9&&l<=CUSTOM_LUM_MAX+1e-9;};
    if(inBand(hex))return hex;
    const n=parseInt(hex.slice(1),16),c=[n>>16&255,n>>8&255,n&255],to=lumOfHex(hex)<CUSTOM_LUM_MIN?255:0;
    for(let i=1;i<=100;i++){const p=1-i/100,x='#'+c.map(v=>Math.round(p*v+(1-p)*to).toString(16).padStart(2,'0')).join('');if(inBand(x))return x;}
    return '#8e8e93';
  }
  // A list's colour of one's own as its title on the dark page (2026-11-03 final review C5): the stored colour stays as chosen for its marks,
  // and the title is lifted toward white only until it reads as well as the palette's weakest there (남보라 #5856d6 on #24262b). Palette colours,
  // the light page (clampColor keeps every colour at least as dark as 노랑) and other values pass through.
  const contrastHex=(a,b)=>{const x=lumOfHex(a),y=lumOfHex(b);return (Math.max(x,y)+0.05)/(Math.min(x,y)+0.05);};
  const TITLE_DARK_MIN=contrastHex('#5856d6','#24262b');
  function titleColor(color,theme){
    if(theme!=='dark'||!isCustomColor(color)||contrastHex(color,'#24262b')>=TITLE_DARK_MIN-1e-9)return color;
    const n=parseInt(color.slice(1),16),c=[n>>16&255,n>>8&255,n&255];
    for(let i=1;i<=100;i++){const p=1-i/100,x='#'+c.map(v=>Math.round(p*v+(1-p)*255).toString(16).padStart(2,'0')).join('');if(contrastHex(x,'#24262b')>=TITLE_DARK_MIN-1e-9)return x;}
    return '#ffffff';
  }
  // A list colour as text on tinted glass (2026-10-21 review): mixed toward white on dark glass, toward black on light glass,
  // only as far as it needs for about 3:1 there (yellow and green need more than blue). Other values pass through.
  // `strength` (0..1, true = 1): on mid-tone glass near the change of text colour (glassLook ink) the colour is mixed further, to
  // about 3:1 at the gap's edges, and as far between — so it deepens a little per step with the glass.
  function inkOn(color,tone,strength){
    if((tone!=='dark'&&tone!=='light')||!/^#[0-9a-f]{6}$/i.test(color||''))return color;
    const n=parseInt(color.slice(1),16),c=[n>>16&255,n>>8&255,n&255];
    const lin=v=>{v/=255;return v<=0.04045?v/12.92:((v+0.055)/1.055)**2.4;};
    const lum=k=>0.2126*lin(k[0])+0.7152*lin(k[1])+0.0722*lin(k[2]);
    const dark=tone==='dark',to=dark?255:0;
    const k=strength===true?1:Math.min(1,Math.max(0,Number(strength)||0)),high=0.55+0.25*k,low=0.1-0.075*k;
    for(let p=1;p>=0.1;p-=0.05){const m=c.map(v=>Math.round(p*v+(1-p)*to));if(dark?lum(m)>=high:lum(m)<=low)return '#'+m.map(v=>v.toString(16).padStart(2,'0')).join('');}
    return dark?'#ffffff':'#1c1d22';
  }
  // Glass on the wallpaper follows its brightness, like Apple's clear look (2026-10-21 user choice: dark glass with white text
  // on a dark wallpaper, light glass on a light one). L is the measured luminance or null (nothing painted: the app theme
  // decides). A little hysteresis keeps a widget near the middle from flipping while it moves.
  function glassTone(L,previous){
    if(typeof L!=='number'||!Number.isFinite(L))return null;
    if(previous==='dark')return L>0.54?'light':'dark';
    if(previous==='light')return L<0.46?'dark':'light';
    return L<0.5?'dark':'light';
  }
  // Theme and glass strength are independent (1.2.6). A selected theme never changes halfway along the slider.
  // Auto follows the wallpaper, including the opaque endpoint; without a wallpaper it follows the app.
  function widgetTheme(choice,app,wall){
    if(choice==='light'||choice==='dark')return choice;
    if(choice==='auto'&&(wall==='light'||wall==='dark'))return wall;
    return app==='dark'?'dark':'light';
  }
  const GLASS_SLATE=[0.145,0.153,0.18],GLASS_WHITE=[1,1,1];
  function glassLook(level,spread,wall,theme){
    if(!spread||typeof spread.mean!=='number'||!Number.isFinite(spread.mean))return null;
    const g=typeof level==='number'&&Number.isFinite(level)?Math.min(1,Math.max(0,level)):0.5;
    const tone=theme==='dark'?'dark':'light',dark=tone==='dark';
    const low=Number.isFinite(spread.low)?spread.low:spread.mean,high=Number.isFinite(spread.high)?spread.high:spread.mean;
    // Solve the readable clear end once, then interpolate the entire range. Clamping a moving target, or projecting
    // intermediate light/dark blends onto a contrast boundary, leaves several slider positions visually identical.
    const clear=glassTint(0,dark?high:low),start=dark?clear.da:clear.a,t=start+(1-start)*g;
    const tint=dark?GLASS_SLATE:GLASS_WHITE,L=dark?high:low;
    const brightness=L*(1-t)+t*(0.2126*tint[0]+0.7152*tint[1]+0.0722*tint[2]);
    const ink=+Math.min(1,Math.max(0,dark?(brightness-0.2)/0.22:(1-brightness)/0.52)).toFixed(4);
    const sat=(dark?clear.dsat:clear.sat)+(100-(dark?clear.dsat:clear.sat))*g;
    return {tone,t:+t.toFixed(5),tint,sat:+sat.toFixed(3),blur:+(7+17*g).toFixed(3),solid:g>=0.995,ink,mid:ink>0};
  }
  // 「앱과 같게」 (2026-11-03 owner, shown his light app's widgets at 95% clear as near-white cards on his navy wallpaper: 「투명 쪽은
  // 바탕화면 따라 (추천)하되 애플은 어떻게 하고 있는지 찾아보고 애플에 맞춰서 해줘」). Up to the slider's middle the glass is the
  // wallpaper's, exactly 「바탕화면에 맞춤」 (glassLook in the wallpaper's tone): over a dark wallpaper thin dark glass with white text, which
  // is how Apple's clear widgets look there (Apple support, HIG Widgets, WidgetKit accented rendering: clear widgets draw their text white);
  // over a light wallpaper light glass with black text, where Apple keeps white text over a dimming layer and is called hard to read, so this
  // follows the wallpaper as Apple's small glass controls do (judgement, WWDC25 219). From the middle to the opaque end the glass moves step by
  // step to the app's own card (2026-10-28 owner: 「조금씩」, 「화이트 모드로 … 불투명한걸로 선택했다면 하얗게」): its strength and premultiplied
  // colour blend in a line, as 1.2.5 did, and only the text colour changes at once. Where neither text colour reads (the glass between
  // GLASS_DARK_MAX for white text and GLASS_APP_LIGHT for black) is skipped, not held: the upper half of the slider maps piecewise-linearly
  // onto the stretch where the wallpaper's tone reads and the stretch where the app's does, each in proportion to its length, so every 1%
  // step still thickens the glass and the gap is crossed in exactly one step (2026-11-03 final review G1: holding each position in the gap at
  // its nearer edge gave ~15 slider steps of two looks, the flat run 1.2.6 removed). `previous`, the tone shown (app.js, only while the slider
  // stays put), keeps that side for .02 of the slider past the change, as glassTone's band does, so a widget moved across a boundary does not
  // flicker (G2). The text and accents reach full strength at the edge on either side; on the wallpaper's side they rise in a line from the
  // middle's own strength, so the step past the middle does not jump (G3). A wallpaper of the app's own tone: glassLook. The dark edge is
  // glassLook's (.42); the light one is brighter than glassLook's light ink edge (.48): there the 1.2.7 Apple red (#a8221a at full ink) fell to
  // 1.7:1, and from .66 every accent keeps 3:1 over every wallpaper tests/lists.test.cjs sweeps (1.2.5 used .48 with a near-black red, which
  // the owner called too dark).
  const GLASS_DARK_MAX=0.42,GLASS_APP_LIGHT=0.66,GLASS_APP_HOLD=0.04; // the hold in the upper half's own 0–1 (.02 of the slider)
  function glassLookApp(level,spread,wall,app,previous){
    const own=app==='dark'?'dark':'light',g=typeof level==='number'&&Number.isFinite(level)?Math.min(1,Math.max(0,level)):0.5;
    if((wall!=='dark'&&wall!=='light')||wall===own)return glassLook(g,spread,own,own);
    if(g<=0.5)return glassLook(g,spread,wall,wall);
    const mid=glassLook(0.5,spread,wall,wall);if(!mid)return null;
    const low=Number.isFinite(spread.low)?spread.low:spread.mean,high=Number.isFinite(spread.high)?spread.high:spread.mean;
    const luma=c=>0.2126*c[0]+0.7152*c[1]+0.0722*c[2],over=(L,x)=>L*(1-x.t)+x.t*luma(x.c);
    const from={t:mid.t,c:mid.tint},to={t:0.97,c:own==='dark'?GLASS_SLATE:GLASS_WHITE}; // next to the solid card, as glassLook's own end
    const at=w=>{const t=from.t+(to.t-from.t)*w,p=[0,1,2].map(i=>from.t*from.c[i]+(to.t*to.c[i]-from.t*from.c[i])*w);return {t,c:t>0?p.map(v=>Math.min(1,Math.max(0,v/t))):GLASS_WHITE};};
    const reads=(tone,x)=>tone==='dark'?over(high,x)<=GLASS_DARK_MAX+1e-9:over(low,x)>=GLASS_APP_LIGHT-1e-9;
    // the brightness over a pixel is a line in w, so each edge is one division: e1 where the wallpaper's tone stops reading, e2 where the
    // app's starts (neither found: the whole way, or none of it)
    const edge=(L,limit)=>{const a=over(L,at(0)),b=over(L,at(1))-a;if(Math.abs(b)<1e-9)return null;const e=(limit-a)/b;return e>=0&&e<=1?e:null;};
    const ofTone=tone=>tone==='dark'?edge(high,GLASS_DARK_MAX):edge(low,GLASS_APP_LIGHT);
    let e1=ofTone(wall),e2=ofTone(own);
    if(e1===null)e1=reads(wall,at(0))?1:0;
    if(e2===null)e2=reads(own,at(0))?0:1;
    const E1=e1;if(e2<e1)e1=e2=(e1+e2)/2; // both read on a stretch: change in its middle
    const u=(g-0.5)/0.5,gm=e1+1-e2>0?e1/(e1+1-e2):1;
    const first=previous===wall&&u<=gm+GLASS_APP_HOLD?true:previous===own&&u>=gm-GLASS_APP_HOLD?false:u<=gm;
    const w=first?(gm>0?e1*Math.min(u,gm)/gm:0):(gm<1?e2+(1-e2)*Math.max(0,u-gm)/(1-gm):1),x=at(w),tone=first?wall:own;
    const ink=+Math.min(1,Math.max(0,first?mid.ink+(1-mid.ink)*(E1>0?Math.min(1,w/E1):1):own==='light'?(1-over(low,x))/(1-GLASS_APP_LIGHT):(over(high,x)-0.2)/(GLASS_DARK_MAX-0.2))).toFixed(4);
    const clear=glassTint(0,wall==='dark'?high:low),base=wall==='dark'?clear.dsat:clear.sat; // the wallpaper glass's saturation curve, continued
    return {tone,t:+x.t.toFixed(5),tint:x.c.map(v=>+v.toFixed(4)),sat:+(base+(100-base)*g).toFixed(3),blur:+(7+17*g).toFixed(3),solid:g>=0.995,ink,mid:ink>0};
  }
  // The widget text and accents on glass of a tone at an ink strength (glassLook ink): each between its plain colour (glass well
  // inside the tone, styles.css's own values) and its strong one (at the gap's edge: pure black or white text, secondary nearly as
  // strong, accents mixed by inkOn strong, check circles and + nearly monochrome as on Apple's clear widgets), as the CSS variables
  // app.js applyGlass sets on the widget body. tests/lists.test.cjs checks every step of the glass with these.
  const GLASS_INKS={
    light:{plain:{text:'#1c1d22',second:[44,48,60,0.82],third:[44,48,60,0.7],red:'#ff3b30',note:'#8a6604',dot:'#2a5fc4',flag:'#ff9500',check:[65,'#3a3f4a'],plus:[70,'#000000']},
      strong:{text:'#000000',second:[0,0,0,0.9],third:[0,0,0,0.78],red:'#a8221a',note:'#372902',dot:'#11264e',flag:'#ff9500',check:[20,'#000000'],plus:[20,'#000000']}},
    dark:{plain:{text:'#f3f4f7',second:[236,238,245,0.84],third:[236,238,245,0.72],red:'#ff453a',note:'#f6cf5c',dot:'#9dbdff',flag:'#ff9500',check:[45,'#ffffff'],plus:[45,'#ffffff']},
      strong:{text:'#ffffff',second:[255,255,255,0.92],third:[255,255,255,0.8],red:'#ffe3e0',note:'#fbe7ae',dot:'#dde8ff',flag:'#ff9500',check:[35,'#ffffff'],plus:[35,'#ffffff']},
      flagLift:{from:0.7,to:'#ffc46b',most:0.78}}};
  function glassInks(tone,ink){
    const set=GLASS_INKS[tone==='dark'?'dark':'light'],k=Math.min(1,Math.max(0,Number(ink)||0)),p=set.plain,q=set.strong;
    const rgb=h=>[1,3,5].map(i=>parseInt(h.slice(i,i+2),16)),lerp=(a,b)=>a+(b-a)*k;
    const hex=(a,b)=>{const x=rgb(a),y=rgb(b);return '#'+[0,1,2].map(i=>Math.round(lerp(x[i],y[i])).toString(16).padStart(2,'0')).join('');};
    /* the flag stays Apple's orange whatever the glass (2026-11-09 V67); on dark glass, past the ink where it would fall under 3:1, a lighter orange step by step (tests/lists.test.cjs) */const flag=()=>{const f=set.flagLift;if(!f||k<=f.from)return p.flag;const m=(k-f.from)/(1-f.from)*f.most,x=rgb(p.flag),y=rgb(f.to);return '#'+[0,1,2].map(i=>Math.round(x[i]+(y[i]-x[i])*m).toString(16).padStart(2,'0')).join('');};
    const rgba=(a,b)=>`rgba(${[0,1,2].map(i=>Math.round(lerp(a[i],b[i]))).join(',')},${+lerp(a[3],b[3]).toFixed(3)})`;
    return {'--w-text':hex(p.text,q.text),'--w-secondary':rgba(p.second,q.second),'--w-tertiary':rgba(p.third,q.third),'--w-red':hex(p.red,q.red),
      '--w-note':hex(p.note,q.note),'--w-dot':hex(p.dot,q.dot),'--w-flag':flag(),
      '--w-check-mix':Math.round(lerp(p.check[0],q.check[0]))+'%','--w-check-with':hex(p.check[1],q.check[1]),
      '--w-plus-mix':Math.round(lerp(p.plus[0],q.plus[0]))+'%','--w-plus-with':hex(p.plus[1],q.plus[1])};
  }
  function localCalendarHidden(state){
    if(!(state.calendars||[]).some(c=>c.provider!=='local'&&calendarWritable(c)))return false;
    return !(state.events||[]).some(e=>e.calendarId==='local-calendar');
  }
  // ---- Quick add: a date (and time) typed with the task title, like Reminders and To Do ----
  // Weeks start on Monday, as on Korean calendars: 「이번 주 금요일」 is this week's Friday and
  // 「다음 주 금요일」 the Friday of next week. A bare weekday is the next such day (today's weekday
  // means a week later). Month-day dates roll to next year once passed. A time (오후 3시, 15:30)
  // becomes a reminder on that day; with no date it is today, or tomorrow once the time has passed,
  // and a time that is already past on the given day is left in the title. A bare 「3시」 is not a time.
  const quickStrip=(raw,m)=>(raw.slice(0,m.index)+' '+raw.slice(m.index+m[0].length)).replace(/\s+/g,' ').trim();
  // 「매주 월요일 보고」 / "every monday report" is a repeat, which quick add does not set (a task's repeat is chosen in its dialog,
  // 1.1.3): nothing is read from it, so the title stays whole instead of becoming a one-off 「매주 보고」 on Monday (2026-10-27
  // review). m[1] is the space before the token.
  const repeatBefore=(text,m)=>/(?:^|\s)(?:매주|격주|매달|매월|매년|매일|매|every|each|other|daily|weekly)\s*$/i.test(text.slice(0,m.index+m[1].length));
  // 「이번 주 금요일」 typed on Saturday or Sunday is the coming Friday, as Reminders reads it, never a day already past (2026-10-27 review).
  function quickWeekDay(today,weeks,idx){const dow=fromDate(today).getDay();const key=dayOffset(today,-((dow+6)%7)+7*weeks+((idx+6)%7));return key<today?dayOffset(key,7):key;}
  function quickNextDay(today,idx){let delta=(idx-fromDate(today).getDay()+7)%7;if(delta===0)delta=7;return dayOffset(today,delta);}
  function quickMonthDay(today,mo,da){
    const real=key=>dateKey(fromDate(key))===key?key:'';
    const year=Number(today.slice(0,4));const key=real(`${year}-${pad(mo)}-${pad(da)}`);
    if(!key)return '';
    return key<today?real(`${year+1}${key.slice(4)}`):key;
  }
  function quickTime(result,m,hour,minute,today,now){
    if(!(hour>=0&&hour<24&&minute>=0&&minute<60))return result;
    const at=day=>new Date(`${day}T${pad(hour)}:${pad(minute)}:00`);
    let day=result.dueDate||today;
    if(!result.dueDate&&!(at(day)>now))day=dayOffset(day,1);
    const when=at(day);
    if(!(when>now))return result;
    return {title:quickStrip(result.title,m),dueDate:day,reminderAt:when.toISOString()}; // '' when the time was all that was left: the parsers keep the typed line (2026-11-09 F73)
  }
  // "3:30" with no 오전/오후 (am/pm) and no leading zero can be either time (2026-10-20 review: "3:30 회의" typed at
  // 14:00 became 03:30 tomorrow): today it is the next one still ahead; on a later day the daytime reading wins
  // (1–6 afternoon, 7–11 morning). "03:30" and 13–23 stay 24-hour.
  function quickClock(result,m,written,hour,minute,today,now){
    if(hour>=7&&hour<=11&&!/^0/.test(written)&&EVENING.test(result.title))return quickTime(result,m,hour+12,minute,today,now); // 「7시 팀 회식」
    if(hour>=1&&hour<=11&&!/^0/.test(written)){
      const day=result.dueDate||today;const at=h=>new Date(`${today}T${pad(h)}:${pad(minute)}:00`);
      if(day===today&&at(hour)>now){/* the morning time is still ahead */}
      else if(day===today&&at(hour+12)>now)hour+=12;
      else if(hour<=6)hour+=12;
    }
    return quickTime(result,m,hour,minute,today,now);
  }
  const QUICK_WEEK_KO='일월화수목금토';
  // A period word before the hour decides AM/PM (2026-11-02 review usability-3: 「밤 11시 약 먹기」 fell through to the bare-clock guess
  // and became 11:00 AM with 「밤」 left in the title). quickClock stays for a bare 「3시」 only (2026-10-26 rule). 「낮 12시」「정오」 are 12:00,
  // 「새벽/오전 12시」 00:00 of the same day. Beyond the review's table: 「밤 1시」–「밤 5시」 are the small hours (nobody says 밤 for 1–5 PM) and
  // 「낮 11시」 is 11 AM (낮 reads like quickClock's daytime: 7–11 morning, 1–6 afternoon).
  const PERIOD_KO={새벽:0,아침:0,오전:0,낮:12,오후:12,저녁:12,밤:12};
  // A night hour (「밤/저녁 12시」, 「밤 1–5시」, 「자정」, "tonight at 12", midnight) belongs to the given day's night: with a date it is the next
  // morning (「내일 밤 12시」 = 모레 00:00); with no date quickTime already takes the next one still ahead (typed at 00:30, 「밤 1시」 is in half an
  // hour). A night hour that does not make a time (「내일 밤 12시 75분」) gives back the untouched result, so the moved date never sticks alone.
  const quickNight=(result,m,hour,minute,today,now)=>{if(!result.dueDate)return quickTime(result,m,hour,minute,today,now);const r=quickTime({...result,dueDate:dayOffset(result.dueDate,1)},m,hour,minute,today,now);return r.reminderAt?r:result;};
  // 「다음 달 N일」 / "next month N" is that day of next month (12 → January: the month-day roll of quickMonthDay takes a past January to next
  // year); 「이번 달 N일」 / "this month N" is this month's day only while it is still ahead — quickMonthDay would roll a past one to next year.
  const quickNextMonth=(today,da)=>quickMonthDay(today,Number(today.slice(5,7))%12+1,da);
  const quickThisMonth=(today,da)=>{const key=today.slice(0,8)+pad(da);return key>=today&&dateKey(fromDate(key))===key?key:'';};
  // An app password as Apple shows it, four groups of four letters (2026-11-06). Spaces go, 16 letters pasted without hyphens get them, the case stays.
  // ok false is only a warning: Apple's article gives no format, so the shape never stops a save.
  function appPassword(raw){const text=String(raw||'').replace(/\s+/g,'');const value=/^[A-Za-z]{16}$/.test(text)?text.match(/.{4}/g).join('-'):text;return {value,ok:/^[A-Za-z]{4}(?:-[A-Za-z]{4}){3}$/.test(value)};}
  // The many ways people write one day or hour (2026-11-06 owner: 「사람마다 또 상황마다 장소나 날짜나 스케줄 제목을 입력하는 방법이나 순서 등등이
  // 다르니깐 제대로 잘 작동하도록 꼼꼼하게 규칙 등을 잘 설정해줘.」; rules, not a model: 「AI를 붙이면 구동도 느리고 무거워지니깐」), put in the plain
  // words the rules below read. The corpus is tests/fixtures/nl-corpus.jsonl. A line nothing is read from keeps what was typed (parseQuickKo).
  const KO_HOURS={한:1,두:2,세:3,네:4,다섯:5,여섯:6,일곱:7,여덟:8,아홉:9,열:10,열한:11,열두:12};
  // A day word ends here, or at a particle that ends here: 「차주에게」 is a person (Codex fifth review F5).
  const DAY_EDGE='(?:\\s|$|[,，]|\\d|새벽|아침|오전|낮|오후|저녁|밤|정오|자정)';
  const WORD_END='(?='+DAY_EDGE+'|(?:까지|부터|에는|에|엔|중으로|중에|중|안으로|안에|안)'+DAY_EDGE+')';
  const QUICK_SAME=[[new RegExp('(^|\\s)(?:낼|내일)\\s?모레'+WORD_END,'g'),'모레'],[new RegExp('(^|\\s)금일'+WORD_END,'g'),'오늘'],[new RegExp('(^|\\s)(?:명일|익일|낼)'+WORD_END,'g'),'내일'],[new RegExp('(^|\\s)차주'+WORD_END,'g'),'다음 주'],[new RegExp('(^|\\s)tomorrow'+WORD_END,'gi'),'내일'],[new RegExp('(^|\\s)today'+WORD_END,'gi'),'오늘']];
  const QUICK_YOIL=new RegExp('(^|\\s)([월화수목금토일])욜'+WORD_END,'g');
  // After a day, a figure is not a date or a time: 「3.5 버전」, 「1.5배」 are amounts, with their particles too; 「다음 주 일 정리」 is not Sunday.
  const DOT_UNIT=/^\s*(?:버전|배|리터|킬로|km|kg|cm|mm|m|g|l|%|퍼센트|프로|점|평|인치|도|만|억|천|원|달러|시간|분|초)(?:으로|에서|부터|까지|보다|짜리|로|의|을|를|이|가|은|는|에|만|도)?(?=\s|$)/i;
  const DOT_BEFORE=/(?:버전|ver\.?|v|평점|학점|GPA|iOS|안드로이드|윈도우)\s*$/i;
  // Each change is kept in undo: what stays in the title goes back to what was typed (quickTyped; Codex fifth review F4, F5).
  function quickPlain(raw,undo=[]){
    const swap=(text,re,fn)=>text.replace(re,(...args)=>{const out=fn(...args);if(out!==args[0])undo.push([out.trim(),args[0].trim()]);return out;});
    let text=String(raw);
    for(const [from,word] of QUICK_SAME)text=swap(text,from,(all,lead)=>lead+word);
    text=swap(text,QUICK_YOIL,(all,lead,day)=>lead+day+'요일');
    text=swap(text,/(^|\s)(다다음|다음|이번|담)\s?주\s?([월화수목금토])(?=\s|$)/g,(all,lead,which,day)=>lead+which+' 주 '+day+'요일');
    text=swap(text,/(\d일|요일|\d{1,2}\/\d{1,2}|\d{1,2}\.\d{1,2})\s?\([월화수목금토일](?:요일)?\)/g,(all,day)=>day);
    text=swap(text,/(^|\s)(\d{1,2})\.(\d{1,2})\.?(?=\s|$)/g,(all,lead,mo,da,at,whole)=>{const rest=whole.slice(at+all.length);return Number(mo)>=1&&Number(mo)<=12&&Number(da)>=1&&Number(da)<=31&&!DOT_UNIT.test(rest)&&!DOT_BEFORE.test(whole.slice(0,at))?lead+mo+'/'+da:all;});
    text=swap(text,/(오늘|내일|모레|글피|\d일|요일)(\d{1,2}(?:시|:[0-5]\d))/g,(all,day,time)=>day+' '+time);
    text=swap(text,/(^|[\s,，]|새벽|아침|오전|낮|오후|저녁|밤)(열두|열한|다섯|여섯|일곱|여덟|아홉|한|두|세|네|열)\s?시(?=\s|$|반|에|까지|부터|쯤)/g,(all,lead,hour)=>lead+KO_HOURS[hour]+'시');
    return swap(text,/(^|[\s,，])(\d{1,2})(?::([0-5]\d))?\s?(am|pm)(?=[\s,，]|$|[~\-–—])/gi,(all,lead,hour,minute,half)=>lead+(half.toLowerCase()==='am'?'오전 ':'오후 ')+hour+(minute?':'+minute:'시'));
  }
  // Whole words only: 「금일 오늘의집 주문」 read 금일 as the day, and 오늘의집 is a name, not the word it became (Codex fifth review, recheck N1).
  const wordAt=(line,word)=>{for(let at=line.indexOf(word);at>=0;at=line.indexOf(word,at+1)){const end=at+word.length;if((at===0||/[\s,，]/.test(line[at-1]))&&(end===line.length||/[\s,，]/.test(line[end])))return at;}return -1;};
  const quickTyped=(text,undo)=>undo.reduceRight((line,[out,was])=>{const at=wordAt(line,out);return at<0?line:line.slice(0,at)+was+line.slice(at+out.length);},text);
  // 「7시 팀 회식」 is in the evening; a bare hour reads as the day otherwise (quickClock, parseEventKo).
  const EVENING=/회식|저녁|뒤풀이|술자리|야식|송년회|망년회|신년회|치맥|dinner|supper|drinks?|party|concert/i;
  // 「2시 방향」, 「16:10 모니터」: an hour's shape, not a time.
  const NOT_A_TIME=/^\s*(?:방향|방면|쪽|모니터|화면|비율|ratio|aspect|monitor|display|screen)/i;
  // A new event typed as one line (2026-11-05 owner, Notion Calendar / Apple Calendar quick event): a time (「2시」, 「오후 2시」, 「10:30」, 「저녁 7시
  // 반」 — with no period word 1–6 is afternoon and 7–11 morning, as an event's hour is meant, evening with 회식·저녁 in the line), a range (「2시~4시」,
  // 「2-3시」, 「1시부터 3시까지」, 「3시부터 1시간」 — 까지 alone is a deadline and stays typed), a date (parseQuickKo's words), and the rest: split at
  // commas, the last part is the place (the first when only it names one: 「강남역, 2시, 동기 모임」); with no comma a last word that names a place
  // (…실·…관·…역, 412호, 3층 회의실), 「…에서」, 「장소: …」, 「@…」, or a place right before the time. Nothing understood → null.
  const EVENT_PLACE=/(?:회의실|강의실|세미나실|연구실|실험실|상담실|연습실|휴게실|교실|본부장실|사장실|대표실|임원실|원장실|교수실|행정실|교무실|보건실|접견실|대기실|사무[실]|도서관|미술관|박물관|체육관|전시관|영화관|공학관|과학관|학생회관|회관|센터|병원|의원|치과|약국|학교|유치원|어린이집|캠퍼스|카페|공원|호텔|리조트|식당|레스토랑|강당|교회|성당|운동장|경기장|수영장|헬스장|공연장|교육장|예식장|웨딩홀|컨벤션홀|아트홀|콘서트홀|스터디룸|미팅룸|세미나룸|터미널|공항|마트|백화점|보건소|연구소|구청|시청|군청|법원|세무서|경찰서|우체국|은행|본사|지사|지점|사옥|코엑스|벡스코|킨텍스|스타벅스|투썸플레이스|이디야|메가박스|롯데시네마|CGV)$/; // a last word ending only in 실·관·점 is not enough (Codex third review N2: 개선점, 세계관)
  // 사무[실]: a character class, as the plain word is one the public export refuses (scripts/public-text-rules.cjs); tests/nl-corpus.test.cjs reads it.
  const EVENT_AREA=/^(?:강남|홍대|신촌|이태원|명동|종로|광화문|을지로|여의도|잠실|판교|성수|압구정|합정|상암|마곡|건대|서초|송파|용산|마포|동대문|청담|역삼|선릉|사당|노원|부산|대구|대전|광주|울산|세종|제주|인천|수원|일산|분당|성남|용인)$/;
  const EVENT_STATION=/^[가-힣]{1,8}역$/,NOT_STATION=/(?:지역|영역|구역|전역|무역|번역|통역|직역|의역|배역|주역|용역|권역|해역|성역|수역)$/;
  const placeWord=word=>EVENT_PLACE.test(word)||EVENT_AREA.test(word)||(EVENT_STATION.test(word)&&!NOT_STATION.test(word))||/^[A-Za-z]?\d{3,4}호$/.test(word);
  const PLACE_BEFORE=/^(?:지하|시내|동네|근처|\d+층|[A-Za-z]\d+층|지하\d+층|\d+학년|\d+반|\d+관|[A-Z]동|\d+동)$/; // what may stand before the place word: 3층 회의실
  // Where a line's place starts among its words, or -1: its last word (or one before a room's letter: 회의실 B), with what stands before it.
  function placeStart(words){
    let at=words.length-1;
    if(at>=1&&/^(?:[A-Z]|\d{1,2})$/.test(words[at])&&placeWord(words[at-1]))at--;
    else if(!placeWord(words[at]))return -1;
    while(at>0&&(PLACE_BEFORE.test(words[at-1])||placeWord(words[at-1])))at--;
    return at;
  }
  const EVENT_HOUR=String.raw`(\d{1,2})(?:시(?:\s?(반|\d{1,2}분))?|:([0-5]\d))`;
  const EVENT_PERIOD='(?:(새벽|아침|오전|낮|오후|저녁|밤)\\s?)?';
  // Groups: 1 lead, then period·hour·반/분·MM of the start (2–5) and the end (6–9).
  const EVENT_DASH=new RegExp(String.raw`(^|[\s,，])${EVENT_PERIOD}(\d{1,2})(?:시(?:\s?(반|\d{1,2}분))?|:([0-5]\d))?\s?[~\-–—]\s?${EVENT_PERIOD}${EVENT_HOUR}(?:까지)?(?=[\s,，]|$|에)(?:에)?`);
  const EVENT_SPAN=new RegExp(String.raw`(^|[\s,，])${EVENT_PERIOD}${EVENT_HOUR}(?:부터|에서)\s?${EVENT_PERIOD}${EVENT_HOUR}(?:까지)?(?=[\s,，]|$)`);
  const EVENT_LONG=new RegExp(String.raw`(^|[\s,，])${EVENT_PERIOD}${EVENT_HOUR}부터\s?(?:(\d{1,2})시간(?:\s?(반))?|(\d{1,3})분)(?:\s?동안)?(?=[\s,，]|$)`);
  const EVENT_AT=new RegExp(String.raw`(^|[\s,，])${EVENT_PERIOD}${EVENT_HOUR}(?=[\s,，]|$|에|부터|까지|쯤|경|\s전까지|\s전에)(?:에|부터|까지|쯤|경|\s전까지|\s전에)?`);
  const minutesOf=(word,mm)=>word==='반'?30:word?parseInt(word,10):mm?Number(mm):0;
  // An hour as it is meant: a period word decides; with none 1–6 is afternoon, 7–11 morning, or evening when the line says so. 「03:30」 is 24-hour.
  function eventClock(period,hourText,word,mm,evening){
    let hour=Number(hourText);const minute=minutesOf(word,mm);
    if(hour>23||minute>59)return null;
    if(period==='오후'||period==='저녁'||period==='밤')hour=hour<12?hour+12:hour;
    else if(period==='오전'||period==='아침'||period==='새벽')hour=hour===12?0:hour;
    else if(period==='낮')hour=hour>=1&&hour<=6?hour+12:hour;
    else if(!/^0/.test(hourText)&&hour>=1&&hour<=6)hour+=12;
    else if(!/^0/.test(hourText)&&hour>=7&&hour<=11&&evening)hour+=12;
    return hour<24?{h:hour,m:minute}:null;
  }
  // The end of a range after its start: its own period word decides; otherwise the first reading of the hour after the start (오전 11시~1시 is 13:00).
  function eventEnd(start,period,hourText,word,mm){
    const hour=Number(hourText);const minute=minutesOf(word,mm);const from=start.h*60+start.m;
    if(period){const at=eventClock(period,hourText,word,mm,false);return at&&at.h*60+at.m>from?at:null;}
    if(hour>23||minute>59)return null;
    for(const h of hour<=12?[hour,hour+12]:[hour])if(h<24&&h*60+minute>from)return {h,m:minute};
    return null;
  }
  // A line the reader leaves alone on purpose (a deadline, the midnight, a repeat), told apart from one it found nothing in: 자주 쓰는 일정 stays out of the first.
  const halted=seen=>{if(seen)seen.stopped=true;return null;};
  function parseEventKo(raw,now=new Date(),seen){
    const typed=String(raw||'').trim();if(!typed)return null;
    const undo=[];let text=quickPlain(typed,undo);
    // 「오전까지 결재」, 「자정 점검」: a deadline and the midnight stay as typed (Codex third review N1, N6).
    if(/(^|\s)(?:(?:오전|오후|점심|정오)\s?까지|자정)(?=\s|$)/.test(text))return halted(seen);
    let location='',allDay=false;
    const whole=text.match(/(^|[\s,，])하루\s?종일(?=[\s,，]|$)/);
    if(whole){allDay=true;text=(text.slice(0,whole.index)+whole[1]+text.slice(whole.index+whole[0].length)).trim();}
    // 「장소: 코엑스 3시 박람회」: the place ends at the comma or the hour.
    const named=text.match(/(^|[\s,，])(?:장소|위치)\s?[:：]\s?([^,，]+?)(?=\s*(?:[,，]|$|(?:새벽|아침|오전|낮|오후|저녁|밤)\s?\d|\d{1,2}시|\d{1,2}:\d\d))/)||text.match(/(^|[\s,，])@\s?([^\s,，]+)/);
    if(named){location=named[2].trim();text=(text.slice(0,named.index)+named[1]+text.slice(named.index+named[0].length)).trim();}
    const evening=EVENING.test(text);let time=null,end=null,at=-1;
    const cut=m=>{at=m.index;text=(text.slice(0,m.index)+m[1]+' '+text.slice(m.index+m[0].length)).trim();};
    const dash=text.match(EVENT_DASH),span=dash?null:text.match(EVENT_SPAN),long=dash||span?null:text.match(EVENT_LONG);
    if(dash||span){
      const r=dash||span;const start=eventClock(r[2],r[3],r[4],r[5],evening);const stop=start&&eventEnd(start,r[6],r[7],r[8],r[9]);
      if(start&&stop){time=start;end=stop;cut(r);}
    }else if(long){
      const start=eventClock(long[2],long[3],long[4],long[5],evening);const minutes=long[8]?Number(long[8]):Number(long[6])*60+(long[7]?30:0);const stop=start?start.h*60+start.m+minutes:0;
      if(start&&minutes>0&&stop<1440){time=start;end={h:Math.floor(stop/60),m:stop%60};cut(long);}
    }
    if(!time){
      const t=text.match(EVENT_AT);
      if(t){
        const after=text.slice(t.index+t[0].length);
        // 「7시까지 제출」 is a deadline, 「2시 방향」 a direction, 「밤 12시」 midnight of the next day — none is when the event starts, so the line
        // stays as typed. 「24시 편의점」 is a name: the hour stays in the line.
        if(/(?:까지|전까지|전에)$/.test(t[0])||NOT_A_TIME.test(after)||(t[2]==='밤'&&Number(t[3])===12))return halted(seen);
        if(Number(t[3])!==24){const clock=eventClock(t[2],t[3],t[4],t[5],evening);if(clock){time=clock;cut(t);}}
      }else{const noon=text.match(/(^|[\s,，])정오(?:에)?(?=[\s,，]|$)/);if(noon){time={h:12,m:0};cut(noon);}}
    }
    const today=dateKey(now);const before=at>0?text.slice(0,at).trim():'';
    const day=quickDayKo(text,today);const date=day.dueDate;if(date)text=day.title;
    if(day.stop&&!time&&!location&&!allDay)return halted(seen); // 「매주 화요일 피아노 학원」: a repeat is chosen in the card
    if(!location){
      // Only a word that names a place: 「보고서에서 오타 찾기」 is not at 보고서 (Codex fifth review F3); other names go after a comma, 장소: or @.
      const from=text.match(/(^|[\s,，])([^\s,，]+?)에서(?=[\s,，]|$)/);
      if(from&&(placeWord(from[2])||/^(?:집|댁|회사|직장|온라인|줌|Zoom|Teams|팀즈)$/i.test(from[2]))&&!/까지(?:\s|$)/.test(text.slice(from.index+from[0].length))){
        const left=text.slice(0,from.index+from[1].length).split(/\s+/).filter(Boolean);const place=[from[2]];
        while(left.length&&(PLACE_BEFORE.test(left.at(-1))||placeWord(left.at(-1))))place.unshift(left.pop());
        location=place.join(' ');text=(left.join(' ')+' '+text.slice(from.index+from[0].length)).trim();
      }
    }
    const parts=text.split(/[,，]/).map(s=>s.replace(/\s+/g,' ').trim()).filter(Boolean);
    let title='';
    if(location)title=parts.join(' · ');
    else if(parts.length>=2){
      if(parts[0].split(' ').every(word=>placeWord(word)||PLACE_BEFORE.test(word))&&!placeWord(parts.at(-1).split(' ').at(-1))){location=parts[0];title=parts.slice(1).join(' · ');}
      else{title=parts.slice(0,-1).join(' · ');location=parts.at(-1);}
    }else{
      const words=(parts[0]||'').split(' ').filter(Boolean);const start=words.length>=2?placeStart(words):-1;
      if(start>0){location=words.slice(start).join(' ');title=words.slice(0,start).join(' ');}
      else{
        const lead=before?quickDayKo(before,today).title.trim():'';
        if(lead&&words.length>=2&&words[0]===lead&&placeWord(lead)){location=lead;title=words.slice(1).join(' ');}
        else title=words.join(' ');
      }
    }
    if(!time&&!date&&!location&&!allDay)return null;
    return{title:quickTyped(title,undo)||typed,date,time,...(end?{end}:{}),location:quickTyped(location,undo),...(allDay&&!time?{allDay:true}:{})};
  }
  // The last day of a month from today's (0: this one); N months on, on the same day or the month's last.
  const monthEnd=(today,months)=>{const d=fromDate(today);return dateKey(new Date(d.getFullYear(),d.getMonth()+months+1,0));};
  const monthsOn=(today,months)=>{const d=fromDate(today);const last=new Date(d.getFullYear(),d.getMonth()+months+1,0).getDate();return dateKey(new Date(d.getFullYear(),d.getMonth()+months,Math.min(d.getDate(),last)));};
  const KO_DAYS={이틀:2,사흘:3,나흘:4,닷새:5,엿새:6,이레:7,열흘:10,보름:15};const KO_COUNT={한:1,두:2,세:3};
  // 「11월 3일 회의록 정리」, "Nov 3 minutes": a day just past is what the line is about, not that day next year.
  const justPast=(today,mo,da)=>{const key=`${today.slice(0,4)}-${pad(mo)}-${pad(da)}`;return key<today&&key>=dayOffset(today,-31);};
  // The day a line names, and the line without it. stop: a repeat, nothing is read from the line.
  function quickDayKo(text,today){
    let result={title:text,dueDate:'',stop:false};
    // 「3일 후」, 「이틀 뒤」, 「2주 뒤」, 「한 달 후」 from today.
    const later=text.match(/(^|\s)(?:(\d{1,3})일|(이틀|사흘|나흘|닷새|엿새|이레|열흘|보름)|(\d{1,2}|한|두|세)\s?주일?|(일주일)|(\d{1,2}|한|두|세)\s?달)\s?(?:후|뒤)(?:에는|에|까지)?(?=\s|$)/);
    if(later){
      const count=v=>KO_COUNT[v]||Number(v);
      const date=later[2]?dayOffset(today,Number(later[2])):later[3]?dayOffset(today,KO_DAYS[later[3]]):later[4]?dayOffset(today,7*count(later[4])):later[5]?dayOffset(today,7):monthsOn(today,count(later[6]));
      return {title:quickStrip(text,later)||text,dueDate:date,stop:false};
    }
    // A date word may run straight into the time or a digit (「내일오후3시」, 「내일3시」, 「내일밤11시」) and M/D is a date too (2026-10-26 usability review).
    const m=text.match(/(^|\s)((다다음|다음|이번|담)\s?주\s?([월화수목금토일])요일|오늘|내일|모레|그글피|글피|다다음\s?주|다음\s?주|담주|([월화수목금토일])요일|(\d{1,2})월\s?(\d{1,2})일|(\d{1,2})\/(\d{1,2})|(다음|이번)\s?달\s?(\d{1,2})일|(?:다음|이번|이)\s?달\s?말|(?:월말|연말|올해\s?말)(?=까지)|(\d{1,2})일(?!\s*(?:후|뒤|전|동안)(?:에는|에|엔|부터|까지|만|은|는|도|면|의|쯤|로|인)*(?=\s|$|[.,!?…:;]))(?!\s*(?:완성|챌린지|코스|과정|플랜|프로그램|분량|연속)(?:\s|$))(?!\d+(?!\d)(?!시|:)))(?:\s?(?:중으로|중에|중|내로|안에|안으로))?(?:까지|부터|쯤|에는|에|엔)?(?=\s|$|[,，]|새벽|아침|오전|낮|오후|저녁|밤|정오|자정|\d)/);
    if(m&&repeatBefore(text,m))return {...result,stop:true};
    if(m){
      const token=m[2].replace(/\s/g,'');let date='';
      if(m[4])date=quickWeekDay(today,m[3]==='이번'?0:m[3]==='다다음'?2:1,QUICK_WEEK_KO.indexOf(m[4]));
      else if(token==='오늘')date=today;
      else if(token==='내일')date=dayOffset(today,1);
      else if(token==='모레')date=dayOffset(today,2);
      else if(token==='글피')date=dayOffset(today,3);
      else if(token==='그글피')date=dayOffset(today,4);
      else if(token==='다음주'||token==='담주')date=dayOffset(today,7);
      else if(token==='다다음주')date=dayOffset(today,14);
      else if(m[5])date=quickNextDay(today,QUICK_WEEK_KO.indexOf(m[5]));
      else if(m[6])date=justPast(today,Number(m[6]),Number(m[7]))?'':quickMonthDay(today,Number(m[6]),Number(m[7]));
      else if(m[8])date=justPast(today,Number(m[8]),Number(m[9]))?'':quickMonthDay(today,Number(m[8]),Number(m[9]));
      else if(m[10])date=(m[10]==='다음'?quickNextMonth:quickThisMonth)(today,Number(m[11]));
      else if(/^(?:이번|이)달말$|^월말$/.test(token))date=monthEnd(today,0);
      else if(token==='다음달말')date=monthEnd(today,1);
      else if(/^(?:연말|올해말)$/.test(token))date=today.slice(0,4)+'-12-31';
      // A bare 「N일」 (2026-11-05 owner 「월을 안 쓰고 일만 쓰면 자동적으로 해당 월의 18일로」): this month's while it is still ahead, else
      // next month's (a past day, or one this month lacks — 「31일」 in November); 「3일간」·「2일째」 stay words (the lookahead).
      else if(m[12])date=quickThisMonth(today,Number(m[12]))||quickNextMonth(today,Number(m[12]));
      if(date)result={title:quickStrip(text,m)||text,dueDate:date,stop:false};
    }
    return result;
  }
  function parseQuickKo(raw,today=dateKey(),now=new Date()){
    const typed=String(raw||'').trim();const undo=[];const text=quickPlain(typed,undo);
    const read=quickLineKo(text,today,now);
    return read.dueDate||read.reminderAt?{...read,title:!read.title||read.title===text?typed:quickTyped(read.title,undo)}:{...read,title:typed};
  }
  function quickLineKo(text,today,now){
    const day=quickDayKo(text,today);let result={title:day.title,dueDate:day.dueDate,reminderAt:''};
    if(day.stop)return result;
    // 「15시」 is 24-hour; a bare 「3시」 reads like a bare 「3:00」 (quickClock) — the event card accepts both, so quick add does too
    // (2026-10-26 usability review; 「3시간」 stays a word). A period word (PERIOD_KO, also before H:MM: 「밤 11:30」) or 정오/자정 is part of the
    // match, so it leaves the title and never reaches quickClock.
    // 「오전까지」·「점심까지」 with no clock is a deadline at noon (2026-11-06 owner: 「"오늘 오전까지 FDI 보고서 송부" … 오전까지 니깐 12시까지로
    // 설정해주는 게 맞지 않을까?」), 「오후까지」 the end of the working day.
    const noon=result.title.match(/(^|\s)(오전|점심|오후)\s?까지(?=\s|$)/);
    if(noon&&!repeatBefore(result.title,noon))return quickTime(result,noon,noon[2]==='오후'?18:12,0,today,now);
    const t=result.title.match(/(^|\s)(?:(새벽|아침|오전|낮|오후|저녁|밤)\s?(\d{1,2})(?:시(?:\s?(반|\d{1,2}분))?|:([0-5]\d))|(\d{1,2})시(?:\s?(반|\d{1,2}분))?|([01]?\d|2[0-3]):([0-5]\d)|(정오|자정))(?:\s전까지|\s전에|까지|쯤|경|에)?(?=\s|$)/);
    if(!t||repeatBefore(result.title,t)||NOT_A_TIME.test(result.title.slice(t.index+t[0].length)))return result;
    const mins=v=>!v?0:v==='반'?30:parseInt(v,10);
    if(t[10])return t[10]==='정오'?quickTime(result,t,12,0,today,now):quickNight(result,t,0,0,today,now);
    if(t[2]){
      const h12=Number(t[3]);const minute=t[5]?Number(t[5]):mins(t[4]);
      // A 24-hour H:MM that agrees with the period word is read as written (「오후 14:00」, 「밤 22:30」, 「밤 0:30」 = that night's 00:30); 1.2.6
      // read these with the word left in the title, and only a clash (「오전 13:00」, 「저녁 0:30」) stays a word (2026-11-02 r60 carry-over G-1).
      if(t[5]&&(h12===0||h12>12)){const pm=PERIOD_KO[t[2]]===12;/* the hour must fit the word: 밤 18–23, 저녁 17–23, 낮 13–17 — 「밤 15:30」 was 3:30 PM (2026-11-03 Codex review F2) */const fits=(t[2]!=='밤'||h12>=18)&&(t[2]!=='저녁'||h12>=17)&&(t[2]!=='낮'||h12<=17);if(h12>=13&&h12<=23&&pm&&fits)return quickTime(result,t,h12,minute,today,now);if(h12===0&&t[2]==='밤')return quickNight(result,t,0,minute,today,now);if(h12===0&&!pm)return quickTime(result,t,0,minute,today,now);return result;}
      if(h12<1||h12>12)return result;
      if(t[2]==='밤'&&(h12===12||h12<=5)||t[2]==='저녁'&&h12===12)return quickNight(result,t,h12%12,minute,today,now);
      return quickTime(result,t,t[2]==='낮'&&h12>=7&&h12<=11?h12:(h12%12)+PERIOD_KO[t[2]],minute,today,now);
    }
    if(t[6]){
      const hour=Number(t[6]);if(hour>23)return result;
      return hour>=13||hour===0||/^0/.test(t[6])?quickTime(result,t,hour,mins(t[7]),today,now):quickClock(result,t,t[6],hour,mins(t[7]),today,now);
    }
    return quickClock(result,t,t[8],Number(t[8]),Number(t[9]),today,now);
  }
  const QUICK_WEEK_EN=['sun','mon','tue','wed','thu','fri','sat'];
  const QUICK_MONTHS_EN=['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];
  const QUICK_WD_EN='sun(?:day)?|mon(?:day)?|tue(?:s|sday)?|wed(?:nesday)?|thu(?:rs|rsday)?|fri(?:day)?|sat(?:urday)?';
  const QUICK_DATE_EN=new RegExp(String.raw`(^|\s)(?:(?:by|on|due)\s+)?((next|this)\s+(${QUICK_WD_EN})|today|tomorrow|next\s?week|(${QUICK_WD_EN})|(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.?\s?(\d{1,2})(?:st|nd|rd|th)?|(\d{1,2})\/(\d{1,2})|(next|this)\s+month\s+(\d{1,2})(?:st|nd|rd|th)?)(?=[\s,，]|$)`,'i');
  // Period words with a bare hour, before or after it ("tonight at 11", "7 tonight"), mirror PERIOD_KO (2026-11-02 review usability-3):
  // tonight / this evening / this afternoon / this night are PM, this morning AM; "tonight at 1"–"at 4" and "tonight / this evening at 12" are
  // night hours (quickNight), "dinner tonight at 5" stays 5 PM. A bare evening / afternoon / morning / night is a time only right before
  // "at N" ("tomorrow night at 11" like 「내일 밤 11시」): a count next to the noun stays a word ("book 2 night stay", "write 3 morning pages",
  // "tomorrow morning 3 reports" — the 2026-10-27 rule; fix review G). An am/pm after the hour leaves the period word too ("tonight at 8pm");
  // one that contradicts it ("tonight at 8am") is a word, like 「밤 15시」. They come first in the alternation so "at 11 tonight" is not read
  // as the bare "at 11" with "tonight" left in the title.
  // Groups: 2–5 period+hour(+am/pm), 6–9 hour(+am/pm)+period, 10–12 am/pm, 13–14 HH:MM, 15 noon|midnight, 16 "at N".
  const QUICK_PERIOD_EN=String.raw`tonight|this\s+(?:evening|afternoon|morning|night)`;
  // After the hour English most often says "at 7 in the morning", "at 11 at night" — and a date word between them leaves a bare noun
  // ("at 7 tomorrow morning" → "at 7 morning"): these follow "at N", "N:MM" or "Nam/pm" only, so a count stays a word ("take 2 in the
  // evening", "book 2 night stay"); before, the bare "at N" guess won and put the reminder in the wrong half of the day with the words left
  // in the title (2026-11-02 r60 integration cal-1).
  const QUICK_AFTER_EN=String.raw`(?<=(?:(?:^|\s)at\s+\d{1,2}(?::[0-5]\d)?(?:\s?(?:am|pm))?|\d{1,2}:[0-5]\d(?:\s?(?:am|pm))?|\d{1,2}\s?(?:am|pm))\s+)(?:in\s+the\s+(?:morning|afternoon|evening)|at\s+night|morning|afternoon|evening|night)`;
  const QUICK_TIME_EN=new RegExp(String.raw`(^|\s)(?:(?:at|by|before)\s+)?(?:(?:in\s+the\s+)?(${QUICK_PERIOD_EN}|(?:evening|afternoon|morning|night)(?=\s+at\s))\s+(?:at\s+)?(\d{1,2})(?::([0-5]\d))?(?:\s?(am|pm))?|(\d{1,2})(?::([0-5]\d))?(?:\s?(am|pm))?\s+(${QUICK_PERIOD_EN}|${QUICK_AFTER_EN})|(\d{1,2})(?::([0-5]\d))?\s?(am|pm)|([01]?\d|2[0-3]):([0-5]\d)|(noon|midnight)|at\s+(\d{1,2}))(?=\s|$)`,'i');
  // "tomorrow dentist", "next friday report", "due oct 25 wedding", "10/25 trip", "call mom 3pm", "next month 1 rent".
  // An English line gets what a Korean one gets (2026-11-07 owner: 「영문 설정에서 … 한글로 입력했을 때 처럼 … 잘 이해하는 거 맞지?」 — it was 47% of the lines of
  // tests/fixtures/nl-corpus.jsonl's English part): the day, 「in 2 weeks」, 「the 25th」, 「end of month」, 「tonight」, 「by noon」, and for an event a range, a
  // length, a place. Which rules read a line goes by the line, not the app's language: Hangul in it, the Korean ones (parseQuickLine, parseEvent).
  const EN_COUNT={a:1,an:1,one:1,two:2,three:3,four:4,five:5,six:6};
  function quickDayEn(text,today){
    const found=(m,dueDate)=>({title:quickStrip(text,m)||text,dueDate,stop:false});
    let m=text.match(/(^|\s)(?:on\s+|by\s+)?(?:the\s+)?day\s+after\s+tomorrow(?=[\s,，]|$)/i);
    if(m)return found(m,dayOffset(today,2));
    m=text.match(/(^|\s)in\s+(an?|one|two|three|four|five|six|\d{1,3})\s+(day|week|month)s?(?=[\s,，]|$)/i);
    if(m){const n=EN_COUNT[m[2].toLowerCase()]??Number(m[2]);const unit=m[3].toLowerCase();return found(m,unit==='day'?dayOffset(today,n):unit==='week'?dayOffset(today,7*n):monthsOn(today,n));}
    m=text.match(/(^|\s)(?:by\s+)?(?:the\s+)?end\s+of\s+(?:the\s+)?(month|year)(?=[\s,，]|$)/i);
    if(m)return found(m,m[2].toLowerCase()==='month'?monthEnd(today,0):today.slice(0,4)+'-12-31');
    m=text.match(/(^|\s)(?:on\s+|by\s+)?the\s+(\d{1,2})(?:st|nd|rd|th)(?=[\s,，]|$)/i);
    if(m){const date=quickThisMonth(today,Number(m[2]))||quickNextMonth(today,Number(m[2]));if(date)return found(m,date);}
    // Three of the short days are words too: 「Sun cream」, 「SAT prep」, 「Mon Cheri」. Alone they need an on/by, a time after them or the line's end; the
    // search goes on past one, for the day the line does name (「SAT prep tomorrow」, Codex sixth review N6).
    for(let from=0;;){
      m=text.slice(from).match(QUICK_DATE_EN);
      if(!m)break;
      m.index+=from;
      if(!(m[5]&&/^(?:sun|sat|mon)$/i.test(m[5])&&!/^\s*(?:by|on|due)\s/i.test(m[0])&&!/^\s*(?:$|,|(?:at\s+)?\d{1,2}(?::\d\d)?\s?(?:am|pm)?(?:\s|,|$))/i.test(text.slice(m.index+m[0].length))))break;
      from=m.index+m[0].length;
    }
    if(m&&repeatBefore(text,m))return {title:text,dueDate:'',stop:true};
    if(m){
      const token=m[2].toLowerCase().replace(/\s/g,'');let date='';
      if(m[4])date=quickWeekDay(today,m[3].toLowerCase()==='this'?0:1,QUICK_WEEK_EN.indexOf(m[4].slice(0,3).toLowerCase()));
      else if(token==='today')date=today;
      else if(token==='tomorrow')date=dayOffset(today,1);
      else if(token==='nextweek')date=dayOffset(today,7);
      else if(m[5])date=quickNextDay(today,QUICK_WEEK_EN.indexOf(m[5].slice(0,3).toLowerCase()));
      else if(m[6]){const mo=QUICK_MONTHS_EN.indexOf(m[6].slice(0,3).toLowerCase())+1;date=justPast(today,mo,Number(m[7]))?'':quickMonthDay(today,mo,Number(m[7]));}
      else if(m[8])date=justPast(today,Number(m[8]),Number(m[9]))?'':quickMonthDay(today,Number(m[8]),Number(m[9]));
      else if(m[10])date=(m[10].toLowerCase()==='next'?quickNextMonth:quickThisMonth)(today,Number(m[11]));
      if(date)return found(m,date);
      return {title:text,dueDate:'',stop:false};
    }
    m=text.match(/(^|\s)next\s+month(?=[\s,，]|$)/i);
    if(m)return found(m,monthsOn(today,1));
    return {title:text,dueDate:'',stop:false};
  }
  // "tomorrow 3 reports" keeps its count, "buy 2 tonight" too; what is read leaves the line, and a line nothing is read from stays as typed.
  function parseQuickEn(raw,today=dateKey(),now=new Date()){
    const typed=String(raw||'').trim();
    const text=typed.replace(/(^|\s)by\s+(today|tomorrow)\s+(morning|afternoon)(?=\s|$)/i,'$1$2 by $3');
    const read=quickLineEn(text,today,now);
    if(!read.dueDate&&!read.reminderAt)return {...read,title:typed};
    return {...read,title:(read.title===text?typed:read.title).replace(/^(?:please\s+)?(?:remind\s+me\s+to|remember\s+to|don['’]?t\s+forget\s+to)\s+/i,'')||typed};
  }
  function quickLineEn(text,today,now){
    const day=quickDayEn(text,today);let result={title:day.title,dueDate:day.dueDate,reminderAt:''};
    if(day.stop)return result;
    // 「by morning」 as 「오전까지」, 「by afternoon」 and the end of the day as 「오후까지」.
    const soon=result.title.match(/(^|\s)(?:(?:by\s+)?(?:the\s+)?(?:end\s+of\s+(?:the\s+)?day|eod)|by\s+(?:morning|afternoon))(?=\s|$)/i);
    if(soon&&!repeatBefore(result.title,soon))return quickTime(result,soon,/morning/i.test(soon[0])?12:18,0,today,now);
    // "at 3" reads like Korean 「3시」 (bare-clock rule), noon is 12:00 and midnight 00:00 of the next day (like 자정); a bare "3" after a
    // date word stays a word ("tomorrow 3 reports", 2026-10-27 review).
    const t=result.title.match(QUICK_TIME_EN);
    if(!t){
      // 「Pick up laundry tonight」: today, the hour left open. A number before it is a count ("buy 2 tonight", 2026-11-02).
      const part=result.title.match(/(^|\s)(tonight|this\s+(?:morning|afternoon|evening))$/i);
      if(part&&!result.dueDate&&!/\d\s*$/.test(result.title.slice(0,part.index)))return {title:quickStrip(result.title,part)||result.title,dueDate:today,reminderAt:''};
      return result;
    }
    if(repeatBefore(result.title,t)||NOT_A_TIME.test(result.title.slice(t.index+t[0].length)))return result;
    const period=(t[2]||t[9]||'').toLowerCase().replace(/^(?:this|in\s+the|at)\s+/,'');
    if(period){
      const h12=Number(t[3]||t[6]);const minute=Number(t[4]||t[7]||0),ampm=(t[5]||t[8]||'').toLowerCase(),clock=Boolean(t[4]||t[7]);
      // A 24-hour H:MM that agrees with the period word, as in Korean: "tonight at 21:00", "this morning 0:30", "tonight 0:30" = that night's
      // 00:30 (2026-11-02 r60 carry-over G-1); "this morning 21:00" stays a word.
      if(clock&&(h12===0||h12>12)){const pm=period!=='morning';if(h12>23||ampm&&(ampm==='pm')!==(h12>=12))return result;/* as in Korean: night 18–23, tonight/evening 17–23, afternoon 13–17 (2026-11-03 Codex review F2) */const fits=(period!=='night'||h12>=18)&&(period!=='tonight'&&period!=='evening'||h12>=17)&&(period!=='afternoon'||h12<=17);if(h12>=13&&pm&&fits)return quickTime(result,t,h12,minute,today,now);if(h12===0&&(period==='tonight'||period==='night'))return quickNight(result,t,0,minute,today,now);if(h12===0&&!pm)return quickTime(result,t,0,minute,today,now);return result;}
      if(h12<1||h12>12)return result;
      const night=(period==='tonight'||period==='night')&&(h12===12||h12<=4)||period==='evening'&&h12===12;
      const hour=night?h12%12:(h12%12)+(period==='morning'?0:12);
      if(ampm&&(ampm==='pm')!==(hour>=12))return result;
      // A bare number in the small hours with no at / :MM / am-pm is a count ("buy 2 tonight", "this morning 3 reports" were 02:00 and 03:00
      // tomorrow); "dinner 7 tonight" and "at 2 tonight" still read (2026-11-02 r60 carry-over G-3). So is a bare 1–5 before an afternoon or
      // evening ("take 3 this evening", "read 2 this afternoon" were 15:00 and 14:00), and the "at" must stand right before the number — "take 2
      // at night" holds an "at" too (2026-11-02 r60 integration cal-1).
      if((hour<=5||h12<=5)&&!clock&&!ampm&&!/(^|\s)at\s+\d/i.test(t[0]))return result;
      return (night?quickNight:quickTime)(result,t,hour,minute,today,now);
    }
    if(t[12]){
      const h12=Number(t[10]);if(h12<1||h12>12)return result;
      return quickTime(result,t,(h12%12)+(t[12].toLowerCase()==='pm'?12:0),t[11]?Number(t[11]):0,today,now);
    }
    if(t[15])return t[15].toLowerCase()==='noon'?quickTime(result,t,12,0,today,now):quickNight(result,t,0,0,today,now);
    if(t[16]){
      const hour=Number(t[16]);if(hour>23)return result;
      return hour>=13||hour===0||/^0/.test(t[16])?quickTime(result,t,hour,0,today,now):quickClock(result,t,t[16],hour,0,today,now);
    }
    return quickClock(result,t,t[13],Number(t[13]),Number(t[14]),today,now);
  }
  // An event typed as one line in English, as parseEventKo reads a Korean one: a time (「3pm」, 「at 7」, 「15:00」, 「noon」; a bare hour reads 1–6 afternoon, 7–11
  // morning, evening with dinner·drinks·party in the line or tonight/night around it), a range (「2-3pm」, 「9am to 5pm」, 「from 2 to 4」, 「3pm for 2 hours」), a
  // date (quickDayEn), a place (「at Main Hall」, 「in Room 204」, 「at home」, after a comma, 「Location: …」, 「@ …」, a last word that names one, a place right before
  // the time). 「by 5pm」 is a deadline and midnight stays typed, as in Korean. 「at the store」, 「in on the team」: lower case and no place word, not a place.
  const EN_PLACE=/^(?:room|station|airport|hall|center|centre|hotel|cafe|café|library|hospital|clinic|park|mall|office|campus|school|university|gym|theater|theatre|restaurant|church|stadium|terminal|coex|starbucks|plaza|tower)$/i;
  const EN_NOT_PLACE=/^(?:january|february|march|april|may|june|july|august|september|october|november|december|monday|tuesday|wednesday|thursday|friday|saturday|sunday|noon)$/i;
  const EN_AT=/(^|[\s,，])(?:at|in)\s+((?:the\s+)?[A-Z][\w'’&.-]*(?:\s+(?:[A-Z][\w'’&.-]*|\d{1,4}[A-Za-z]?|of|the))*)(?=[\s,，]|$)/;
  const EN_AT_LOWER=/(^|[\s,，])(?:at|in)\s+((?:the\s+)?(?:home|work|office|school|gym|library|hospital|clinic|airport|station|church|park|cafe|restaurant))(?=[\s,，]|$)/i;
  const EN_SPAN=/(^|[\s,，])(from\s+)?(\d{1,2})(?::([0-5]\d))?\s?(am|pm)?\s?(?:[-–—~]|to|until|till)\s?(\d{1,2})(?::([0-5]\d))?\s?(am|pm)?(?=[\s,，]|$)/i;
  const EN_FOR=/(^|[\s,，])(at\s+)?(\d{1,2})(?::([0-5]\d))?\s?(am|pm)?\s+for\s+(?:(an?\s+hour)|(\d{1,2})\s?(?:hours?|hrs?)|(\d{1,3})\s?(?:minutes?|mins?))(?=[\s,，]|$)/i;
  const EN_CLOCK=[/(^|[\s,，])(?:at\s+)?(\d{1,2})(?::([0-5]\d))?\s?(am|pm)(?=[\s,，]|$)/i,/(^|[\s,，])at\s+(\d{1,2})(?::([0-5]\d))?()(?=[\s,，]|$)/i,/(^|[\s,，])(\d{1,2}):([0-5]\d)()(?=[\s,，]|$)/];
  const enPeriod=half=>(half==='am'||half==='morning'?'오전':half?'오후':undefined);
  const enPlaceTail=word=>/^[A-Z]/.test(word)&&EN_PLACE.test(word);
  const enCapital=word=>/^[A-Z0-9]/.test(word);
  function enPlaceStart(words){
    let at=words.length-1;
    if(at>=1&&/^(?:[A-Z]|\d{1,4}[A-Za-z]?)$/.test(words[at])&&enPlaceTail(words[at-1]))at--;
    else if(!enPlaceTail(words[at]))return -1;
    while(at>0&&enCapital(words[at-1]))at--;
    return at;
  }
  function parseEventEn(raw,now=new Date(),seen){
    const typed=String(raw||'').trim();if(!typed)return null;
    let text=typed,half='',location='',allDay=false;
    // 「until 5pm」 alone is a deadline; 「9am until 5pm」 a range (Codex sixth review N5).
    const ranged=text.match(EN_SPAN);const outside=ranged&&(ranged[2]||ranged[4]||ranged[5]||ranged[7]||ranged[8])?text.slice(0,ranged.index)+ranged[1]+text.slice(ranged.index+ranged[0].length):text;
    if(/(^|\s)(?:by|before|until|due)\s+(?:\d{1,2}(?::\d\d)?\s?(?:am|pm)?|noon|midnight)(?=[\s,，]|$)/i.test(outside)||/(^|\s)(?:at\s+)?midnight(?=[\s,，]|$)/i.test(text))return halted(seen);
    const whole=text.match(/(^|[\s,，])all[\s-]day(?=[\s,，]|$)/i);
    if(whole){allDay=true;text=(text.slice(0,whole.index)+whole[1]+text.slice(whole.index+whole[0].length)).trim();}
    const named=text.match(/(^|[\s,，])(?:location|place|where)\s?:\s?([^,，]+?)(?=\s*(?:[,，]|$|\d{1,2}(?::\d\d)?\s?(?:am|pm)|at\s+\d))/i)||text.match(/(^|[\s,，])@\s?([^\s,，]+(?:\s+[A-Z][^\s,，]*)*)/);
    if(named){location=named[2].trim();text=(text.slice(0,named.index)+named[1]+text.slice(named.index+named[0].length)).trim();}
    text=text.replace(/(^|[\s,，])(today|tomorrow|sunday|monday|tuesday|wednesday|thursday|friday|saturday)\s+(morning|afternoon|evening|night)(?=[\s,，]|$)/i,(all,lead,day,part)=>{half=part.toLowerCase();return lead+day;});
    text=text.replace(/(^|[\s,，])(?:tonight|this\s+(morning|afternoon|evening|night))(?=[\s,，]|$)/i,(all,lead,part)=>{half=(part||'night').toLowerCase();return lead+'today';});
    const evening=EVENING.test(text);let time=null,end=null,at=-1;
    const STOP='\u0001'; // where the time stood: 「Flight 7am Incheon Airport」, the place starts after it
    const cut=m=>{at=m.index;text=(text.slice(0,m.index)+m[1]+' '+STOP+' '+text.slice(m.index+m[0].length)).trim();};
    const clock=(hour,mm,mark)=>eventClock(enPeriod((mark||'').toLowerCase()||half),hour,undefined,mm,evening);
    const span=text.match(EN_SPAN);
    if(span&&(span[2]||span[4]||span[5]||span[7]||span[8])){
      const a=(span[5]||'').toLowerCase(),b=(span[8]||'').toLowerCase();
      const first=a||(b?(Number(span[3])%12<=Number(span[6])%12?b:b==='pm'?'am':'pm'):'');
      const start=clock(span[3],span[4],first);const stop=start&&eventEnd(start,b?enPeriod(b):undefined,span[6],undefined,span[7]);
      if(start&&stop){time=start;end=stop;cut(span);}
    }
    if(!time){
      const long=text.match(EN_FOR);
      if(long&&(long[2]||long[4]||long[5])){
        const start=clock(long[3],long[4],long[5]);const minutes=long[6]?60:long[7]?Number(long[7])*60:Number(long[8]);const stop=start?start.h*60+start.m+minutes:0;
        if(start&&minutes>0&&stop<1440){time=start;end={h:Math.floor(stop/60),m:stop%60};cut(long);}
      }
    }
    if(!time)for(const re of EN_CLOCK){
      const t=text.match(re);if(!t||NOT_A_TIME.test(text.slice(t.index+t[0].length)))continue;
      const made=clock(t[2],t[3],t[4]);if(made){time=made;cut(t);break;}
    }
    if(!time){const noon=text.match(/(^|[\s,，])(?:at\s+)?noon(?=[\s,，]|$)/i);if(noon){time={h:12,m:0};cut(noon);}}
    const today=dateKey(now);const before=at>0?text.slice(0,at).trim():'';
    const day=quickDayEn(text,today);const date=day.dueDate;if(date)text=day.title;
    if(day.stop&&!time&&!location&&!allDay)return halted(seen); // 「Standup every Monday」: a repeat is chosen in the card
    if(!location){
      // A place needs a place word (「at Main Hall」); 「at Marios」 counts beside a time or a date; 「Training in Python」, 「Alice in Wonderland」 stay titles
      // (Codex sixth review N1).
      const m=text.match(EN_AT)||text.match(EN_AT_LOWER);const words=m?m[2].split(/\s+/):[];
      if(m&&!EN_NOT_PLACE.test(words[0])&&(EN_AT_LOWER.test(m[0])||words.some(word=>EN_PLACE.test(word))||(/^\S*\s*at\s/i.test(m[0])&&(time||date)))){location=m[2];text=(text.slice(0,m.index)+m[1]+text.slice(m.index+m[0].length)).trim();}
    }
    const raws=text.split(/[,，]/).filter(s=>s.replace(STOP,'').trim());
    const parts=raws.map(s=>s.replace(STOP,' ').replace(/\s+/g,' ').trim().replace(/\s+(?:at|in|on|from|for)$/i,'').trim()).filter(Boolean);
    let title='';
    const isPlace=part=>{const words=part.split(' ');return enPlaceStart(words)===0;};
    if(location)title=parts.join(' · ');
    else if(parts.length>=2){
      if(isPlace(parts[0])&&!isPlace(parts.at(-1))){location=parts[0];title=parts.slice(1).join(' · ');}
      else{title=parts.slice(0,-1).join(' · ');location=parts.at(-1);}
    }else{
      const words=(parts[0]||'').split(' ').filter(Boolean);const marked=(raws[0]||'').trim().split(/\s+/).indexOf(STOP);
      let start=words.length>=2?enPlaceStart(words):-1;if(start>=0&&marked>0&&start<marked&&marked<words.length)start=marked;
      if(start>0){location=words.slice(start).join(' ');title=words.slice(0,start).join(' ');}
      else{
        const lead=before?quickDayEn(before.replace(STOP,' '),today).title.trim():'';
        if(lead&&isPlace(lead)&&words.join(' ').startsWith(lead+' ')){location=lead;title=words.join(' ').slice(lead.length+1);}
        else title=words.join(' ');
      }
    }
    if(!time&&!date&&!location&&!allDay)return null;
    return{title:title||typed,date,time,...(end?{end}:{}),location,...(allDay&&!time?{allDay:true}:{})};
  }
  // Hangul in the line: the Korean rules; none: the English ones. The app's language has no say: people type what they type.
  const hasHangul=text=>/[가-힣]/.test(String(text||''));
  const parseQuickLine=(raw,today=dateKey(),now=new Date())=>(hasHangul(raw)?parseQuickKo:parseQuickEn)(raw,today,now);
  const parseEvent=(raw,now=new Date(),seen)=>(hasHangul(raw)?parseEventKo:parseEventEn)(raw,now,seen);
  // 자주 쓰는 일정 (2026-11-08 owner: 「점심 이준우」 → 11:30–12:30, 「🍽️ 이준우」, each user's own words and hours). The line is read as ever first; then
  // the first word of what is left, whole and in any case, names an item. The title always takes the item's shape; a time typed in the line beats
  // hours the user chose (the time grid, the card, days drawn), and those beat the item's. main checks what is saved, the store heals what is read.
  // Twenty is what one makes in the sheet; lists merged from several PCs keep up to three times that, so a merge never drops one (Argon 2026-11-08 G2).
  const SHORTCUT_MAX=20;const SHORTCUT_KEEP=60;
  const SHORTCUT_ID=/^[\w-]{1,64}$/;const SHORTCUT_CLOCK=/^(?:[01]\d|2[0-3]):[0-5]\d$/;
  const shortcutKey=word=>String(word||'').normalize('NFC').toLowerCase();
  const oneLine=(value,max)=>typeof value==='string'?value.replace(/\s+/g,' ').trim().slice(0,max):'';
  const clockOrder=(start,end)=>SHORTCUT_CLOCK.test(start)&&SHORTCUT_CLOCK.test(end)&&start<end;
  function cleanShortcut(raw){
    if(!raw||typeof raw!=='object'||typeof raw.id!=='string'||!SHORTCUT_ID.test(raw.id))return null;
    const word=oneLine(raw.word,30);if(!word||/\s/.test(word))return null;
    const allDay=raw.allDay===true;const start=allDay?'':String(raw.start||'');const end=allDay?'':String(raw.end||'');
    if(!allDay&&!clockOrder(start,end))return null;
    const item={id:raw.id,word,before:oneLine(raw.before,30),after:oneLine(raw.after,30),start,end,allDay,calendarId:typeof raw.calendarId==='string'&&raw.calendarId.length<=400?raw.calendarId:'',color:typeof raw.color==='string'&&/^#[\da-f]{6}$/i.test(raw.color)?raw.color:''};
    if(raw.alert===null||alertOk(raw.alert))item.alert=raw.alert;
    if(Number.isSafeInteger(raw.created)&&raw.created>0)item.created=raw.created; // when it was made (2026-11-09): the sheet lists items in that order
    return item;
  }
  // One word once, in the order they were made (2026-11-09 owner: 「제일 처음한 게 제일 위에 보이는 게 낫지 않을까?」); the stamp travels in the item,
  // so every PC lists them alike. Items from before the stamp come first, by word, as they did.
  function cleanShortcuts(list){
    if(!Array.isArray(list))return [];
    const words=new Set();const ids=new Set();const kept=[];
    for(const raw of list){const item=cleanShortcut(raw);if(!item||words.has(shortcutKey(item.word))||ids.has(item.id))continue;words.add(shortcutKey(item.word));ids.add(item.id);kept.push(item);if(kept.length===SHORTCUT_KEEP)break;}
    return kept.sort((a,b)=>(a.created||0)-(b.created||0)||(shortcutKey(a.word)<shortcutKey(b.word)?-1:1));
  }
  // Why an item cannot be saved, '' when it can: the sheet says so beside the field. 'date': a word the line reads as a day or a time never reaches the items.
  function shortcutProblem(item,others=[]){
    const word=oneLine(item?.word,30);if(!word)return 'empty';if(/\s/.test(word))return 'space';
    const key=shortcutKey(word);if(others.some(other=>other.id!==item.id&&shortcutKey(other.word)===key))return 'same';
    if(!item.allDay&&!clockOrder(item.start,item.end))return 'time';
    for(const name of ['가나다','sample']){const seen={};const line=parseEvent(word+' '+name,new Date(),seen);if(seen.stopped||(line&&shortcutKey(oneLine(line.title,500).split(' ')[0])!==key))return 'date';}
    return '';
  }
  // The document's form (lib/viewsync.cjs K:): one value, so an item never mixes two PCs' edits (a start from one, an end from the other).
  const shortcutValue=item=>[item.word,item.before,item.after,item.start,item.end,item.allDay,item.calendarId,item.color,item.alert===undefined?'':item.alert,item.created===undefined?'':item.created];
  function shortcutFromValue(id,value){
    if(!Array.isArray(value))return null;
    const [word,before,after,start,end,allDay,calendarId,color,alert,created]=value;
    return cleanShortcut({id,word,before,after,start,end,allDay,calendarId,color,...(alert===''?{}:{alert}),...(created===''||created===undefined?{}:{created})});
  }
  function applyShortcut(raw,parsed,list,{chosen=false,stopped=false}={}){
    if(stopped||!Array.isArray(list)||!list.length)return null;
    const title=oneLine(parsed?parsed.title:raw,500);const words=title?title.split(' '):[];const find=word=>{const key=shortcutKey(word);return list.find(entry=>shortcutKey(entry.word)===key);};
    let item=words.length?find(words[0]):null;let rest=words.slice(1);
    if(!item&&words.length>1){item=find(words.at(-1));rest=words.slice(0,-1);}
    if(!item)return null;
    /* 「lunch with Alex」, 「lunch w/ Alex」: English joins the name with a word that goes with the shortcut's (2026-11-08 English check) */if(rest.length>1&&words[0]!==rest[0]&&/^(?:with|w\/)$/i.test(rest[0]))rest=rest.slice(1);
    const hit={...(parsed||{}),title:item.before||item.after?[item.before,rest.join(' ')||item.word,item.after].filter(Boolean).join(' '):title,shortcut:item};
    const onClock=value=>Number(value.slice(0,2))*60+Number(value.slice(3,5));const clock=minutes=>({h:Math.floor(minutes/60)%24,m:minutes%60});
    const length=item.allDay?0:onClock(item.end)-onClock(item.start);
    if(parsed?.time){/* hours picked on the time grid keep their length (Codex 2026-11-08 F3) */if(!parsed.end&&!chosen&&length){hit.minutes=length;hit.end=clock(parsed.time.h*60+parsed.time.m+length);}}
    else if(!parsed?.allDay&&!chosen){if(item.allDay)hit.allDay=true;else{hit.time=clock(onClock(item.start));hit.end=clock(onClock(item.end));hit.minutes=length;}}
    return hit;
  }
  // ---- 「날짜로 이동」 (Apple Calendar ⌘⇧T): the whole box is one date. Unlike quick add, a month-day already past stays in
  // this year (going back is the point), and a year and month alone go to its 1st. Words quick add reads (내일, 다음 주 금요일,
  // next friday) work too when they are all that was typed. '' when it is not a date.
  const GO_MONTHS_EN='jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?';
  function parseGoDate(raw,today=dateKey()){
    const text=String(raw||'').trim().replace(/\s+/g,' ').replace(/[.,]$/,'');if(!text)return '';
    const real=(y,m,d)=>{if(!(y>=1900&&y<=2200))return '';const key=`${y}-${pad(m)}-${pad(d)}`;return dateKey(fromDate(key))===key?key:'';};
    const year=Number(today.slice(0,4)),month=Number(today.slice(5,7));
    const monthEn=name=>QUICK_MONTHS_EN.indexOf(name.slice(0,3).toLowerCase())+1;
    let m;
    if((m=text.match(/^(\d{4})\s?[-./]\s?(\d{1,2})\s?[-./]\s?(\d{1,2})$/)))return real(+m[1],+m[2],+m[3]);
    if((m=text.match(/^(\d{4})\s?[-./]\s?(\d{1,2})$/)))return real(+m[1],+m[2],1);
    if((m=text.match(/^(\d{4})년(?:\s?(\d{1,2})월(?:\s?(\d{1,2})일)?)?$/)))return real(+m[1],m[2]?+m[2]:1,m[3]?+m[3]:1);
    if((m=text.match(/^(\d{1,2})월(?:\s?(\d{1,2})일)?$/)))return real(year,+m[1],m[2]?+m[2]:1);
    if((m=text.match(/^(\d{1,2})일$/)))return real(year,month,+m[1]);
    if((m=text.match(/^(\d{1,2})\s?[/.]\s?(\d{1,2})$/)))return real(year,+m[1],+m[2]);
    if((m=text.match(/^(\d{1,2})\s?[/.]\s?(\d{1,2})\s?[/.]\s?(\d{4})$/)))return real(+m[3],+m[1],+m[2]); // 3/15/2027, month first as M/D
    if((m=text.match(new RegExp(String.raw`^(${GO_MONTHS_EN})\.?(?:\s(\d{1,2})(?:st|nd|rd|th)?)?(?:,?\s(\d{4}))?$`,'i'))))return real(m[3]?+m[3]:year,monthEn(m[1]),m[2]?+m[2]:1);
    if((m=text.match(new RegExp(String.raw`^(\d{1,2})(?:st|nd|rd|th)?\s(${GO_MONTHS_EN})\.?(?:,?\s(\d{4}))?$`,'i'))))return real(m[3]?+m[3]:year,monthEn(m[2]),+m[1]);
    if(/^(어제|yesterday)$/i.test(text))return dayOffset(today,-1);
    // A word quick add reads, typed alone: its title is the whole text again (quickStrip left nothing, so the text came back).
    for(const read of [parseQuickKo,parseQuickEn]){const r=read(text,today,new Date(`${today}T00:00:00`));if(r.dueDate&&r.title===text)return r.dueDate;}
    return '';
  }
  // ---- Task order (Reminders' 「정렬 기준」, To Do's sort): the drag order chosen on this PC, due date, 중요, creation, title.
  // 'due' is the order Dayboard always had (no date last, then 중요, then oldest first), so it stays the default. In the manual
  // order a task not placed yet comes after the placed ones, oldest first: a new row lands next to the add box, as in Reminders.
  const TASK_SORTS=['manual','due','important','created','title'];
  // One collator per language (2026-10-27 review: localeCompare with options built one per comparison — 2,000 titles took 150 ms).
  const collators=new Map();
  function collatorFor(locale){const key=locale||'';if(!collators.has(key))collators.set(key,new Intl.Collator(locale||undefined,{numeric:true,sensitivity:'base'}));return collators.get(key);}
  // importantOf: the 중요 flag as the screen holds it (a flag just clicked keeps its row in place until the pointer leaves).
  // A timed task sorts by its time within its day, after the day's date-only ones (2026-11-05: as a calendar's all-day row comes first).
  function sortTasks(tasks,mode,order,locale,importantOf=t=>t.important){
    const dueKey=t=>{const next=nextDueOf(t);return !next?'9999':next===t.dueDate?next+(dueTimeOk(t.dueTime)?'T'+t.dueTime:''):next;};
    const byDue=(a,b)=>dueKey(a).localeCompare(dueKey(b));
    const byImportant=(a,b)=>Number(Boolean(importantOf(b)))-Number(Boolean(importantOf(a)));
    const byCreated=(a,b)=>String(a.createdAt||'').localeCompare(String(b.createdAt||''));
    let cmp;
    if(mode==='manual'){const rank=new Map((order||[]).map((id,i)=>[id,i]));const at=t=>rank.has(t.id)?rank.get(t.id):Number.MAX_SAFE_INTEGER;cmp=(a,b)=>(at(a)-at(b))||byCreated(a,b);}
    else if(mode==='important')cmp=(a,b)=>byImportant(a,b)||byDue(a,b)||byCreated(a,b);
    else if(mode==='created')cmp=(a,b)=>byCreated(a,b);
    else if(mode==='title'){const collator=collatorFor(locale);cmp=(a,b)=>collator.compare(String(a.title||''),String(b.title||''))||byCreated(a,b);}
    else cmp=(a,b)=>byDue(a,b)||byImportant(a,b)||byCreated(a,b);
    return [...tasks].sort(cmp);
  }
  // ---- A task's time on its date (2026-11-05 owner, with iPhone screenshots: 「아이폰에서 … 할 일을 11/6 금요일 오후 2시로 만들었더니 달력에도
  // 오후 2시로 나와 … 할 일에 날짜와 시간 설정이 되도록 해줘」): 'HH:MM' on this PC's clock beside dueDate, as Apple Reminders has a date and,
  // on it, an optional time. The reminder stays its own field (reminderAt, an instant). Microsoft To Do and this PC keep the time; Google
  // Tasks has none (its API drops the time of `due`), so a Google list never gets one.
  const DUE_TIME=/^([01]\d|2[0-3]):[0-5]\d$/;
  const dueTimeOk=value=>typeof value==='string'&&DUE_TIME.test(value);
  // The instant a timed task is due (its date at its time here); null for a date only.
  function dueAt(task){if(!task?.dueDate||!dueTimeOk(task.dueTime))return null;const at=new Date(`${task.dueDate}T${task.dueTime}:00`);return Number.isFinite(at.getTime())?at:null;}
  // The editor's quick 알림 for a timed task, in minutes before its time (Apple Reminders' early reminder): 제시간에, 5분·30분·1시간·1일 전.
  const TASK_ALERTS=[0,5,30,60,1440];
  // How many minutes before its time a timed task's reminder rings, when that reads as Apple's early-reminder words do — 제시간에, every 5
  // minutes within the hour, whole hours up to a day, whole days up to a week —; null otherwise (a date-only task, a reminder after the
  // time, 「350분 전」): the row and the 알림 field then show the reminder's own time.
  function alertBefore(task){const due=dueAt(task);const at=Date.parse(task?.reminderAt||'');if(!due||!Number.isFinite(at))return null;const gap=(due.getTime()-at)/60000;if(!Number.isInteger(gap)||gap<0)return null;return (gap<60&&gap%5===0)||(gap%60===0&&gap<=1440)||(gap%1440===0&&gap<=10080)?gap:null;}
  // The time 「시간」 gives a date first (2026-11-05 review): the next full hour, as Apple Reminders does — never 자정 (00:00) nor the hour
  // that is midnight UTC on that day (오전 9:00 in Korea), which To Do answers as a date only (lib/providers/microsoft.cjs dueFrom), so the
  // phone may show them all day; the hour after then.
  function defaultDueTime(date,now=new Date()){const utc=new Date(`${date}T00:00:00Z`);const clash=Number.isFinite(utc.getTime())&&utc.getMinutes()===0?utc.getHours():-1;let hour=(now.getHours()+1)%24;while(hour===0||hour===clash)hour=(hour+1)%24;return String(hour).padStart(2,'0')+':00';}
  // ---- Repeating tasks (Reminders, To Do): completing one adds the next, dated the rule's first day after its due date (not
  // after the day it was done — To Do and Reminders count from the due date). '' when the rule has ended (UNTIL, COUNT).
  function nextDue(rruleText,dueKey){
    const rule=parseRRule(rruleText);
    /* the last of a counted repeat ends it: a date moved off the rule's days would otherwise count as not yet taken (2026-11-08 Argon review) */
    if(!/^\d{4}-\d{2}-\d{2}$/.test(String(dueKey||''))||!rule||rule.count===1)return '';
    let next='';
    walkRRule({start:dueKey,allDay:true,rrule:rruleText},o=>{const key=dateKey(o);if(key>dueKey){next=key;return false;}return true;});
    return next;
  }
  // The rule the next task carries: a COUNT counts what is left once this one is done.
  function ruleAfter(rruleText){const rule=parseRRule(rruleText);if(!rule)return '';return buildRRule(rule.count?{...rule,count:Math.max(1,rule.count-1)}:rule);}
  // ---- Event alerts (Apple Calendar 「알림」): minutes before the start. An all-day event counts from midnight of its first
  // day, so 900 is 「1일 전 오전 9시」 and -540 「당일 오전 9시」 (wall clock, as Apple and Google do). The choices the card offers;
  // a value the service has that is not among them is shown as it is.
  const ALERTS_TIMED=[0,5,10,15,30,60,120,1440,2880,10080];
  const ALERTS_ALLDAY=[-540,900,2340,9540];
  const alertOk=value=>Number.isInteger(value)&&value>=-1440&&value<=40320;
  function alertTime(event,minutes){
    if(!alertOk(minutes))return null;
    if(event.allDay){const day=fromDate(String(event.start).slice(0,10));if(!Number.isFinite(day.getTime()))return null;const at=new Date(day.getFullYear(),day.getMonth(),day.getDate(),0,-minutes);return at;}
    const start=new Date(event.start);return Number.isFinite(start.getTime())?new Date(start.getTime()-minutes*60000):null;
  }
  // New event times (Apple Calendar's +): today after 09:00 starts at the next whole hour (at most 23:00) for one hour,
  // so a new event never opens in the past; other days 09:00-10:00. Values are datetime-local strings.
  // The hour an event gets when its time is asked for and none was chosen: the next whole hour of the clock, on any day, an hour long
  // (2026-11-07 owner: 「지금 현재 시간에 가까운 정시로」; 오전 9:00 on every other day read as a setting nobody made). Late evening stays on the day.
  function defaultEventTimes(day,now=new Date()){
    const hour=Math.min(now.getHours()+1,23);
    return [`${day}T${pad(hour)}:00`,hour===23?`${dayOffset(day,1)}T00:00`:`${day}T${pad(hour+1)}:00`];
  }
  // Moving an event's start keeps its length (Apple, Google, Notion): the end moves by the same amount. The strings are
  // read as wall-clock time, so time zones and DST do not matter, and a half-typed year (Chromium fires 'change' per
  // segment: 0002, 0020, 0202, 2027) cannot blank the end field. An end that would not follow the start falls back to the
  // old rule (all-day: same day, timed: +1 hour). Returns the new end value, or null to leave the end alone.
  function followStart(prevStart,start,end,allDay){
    const wall=v=>{const t=String(v||'');return t?Date.parse(t.length===10?t+'T00:00Z':t+'Z'):NaN;};
    const s=wall(start),p=wall(prevStart),e=wall(end);
    if(!Number.isFinite(s))return null;
    let next=Number.isFinite(p)&&Number.isFinite(e)?e+(s-p):NaN;
    if(!Number.isFinite(next)||(allDay?next<s:next<=s))next=allDay?s:s+3600000;
    const d=new Date(next);if(!Number.isFinite(d.getTime()))return null;
    const iso=d.toISOString();
    if(!/^\d{4}-/.test(iso))return null;
    return allDay?iso.slice(0,10):iso.slice(0,16);
  }
  // ---- Week and day views, dragging, the rolling month grid (2026-10-21) ----
  // Weeks start on Sunday like the month grid. Positions are wall-clock minutes of one day (0–1440): an event that starts the
  // day before or ends the day after is clipped to the day, and a DST day keeps its clock labels.
  const weekStart=key=>dayOffset(key,-fromDate(key).getDay());
  const weekDays=key=>{const s=weekStart(key);return Array.from({length:7},(_,i)=>dayOffset(s,i));};
  const localKey=v=>{const t=String(v||'');return t.length===10?t:dateKey(new Date(t));};
  function wallMinutes(value,key){const d=new Date(value);const k=dateKey(d);if(k<key)return 0;if(k>key)return 1440;return d.getHours()*60+d.getMinutes()+d.getSeconds()/60;}
  function atWall(key,minutes){const d=startOfLocalDay(key);d.setMinutes(Math.round(minutes));return d;}
  const snapMinutes=(minutes,step=15)=>Math.round(minutes/step)*step;
  // The all-day row holds all-day events and timed ones of 24 hours or more (Google, Apple, Notion); the rest go in the grid.
  const spansDays=e=>{if(e.allDay)return true;const s=new Date(e.start),en=new Date(e.end||e.start);const days=Math.round((fromDate(dateKey(en))-fromDate(dateKey(s)))/86400000);return days*1440+(en.getHours()*60+en.getMinutes())-(s.getHours()*60+s.getMinutes())>=1440;};
  // Timed events of one day (from eventsOn) as blocks: top/bottom in minutes, at least minHeight tall so a short event stays clickable, and
  // overlapping events side by side — each cluster of overlaps shares the width in as few columns as fit, and an event widens
  // into the columns to its right that are free for its whole time (Google, Notion).
  function dayLayout(events,key,minHeight=20){
    const items=events.map(e=>{const top=wallMinutes(e.start,key),end=wallMinutes(e.end||e.start,key);return {event:e,top,end,bottom:Math.min(1440,Math.max(end,top+minHeight))};}).filter(x=>x.top<1440).sort((a,b)=>a.top-b.top||b.bottom-a.bottom);
    const out=[];let cluster=[],reach=-1;
    const flush=()=>{const cols=[];for(const it of cluster){let c=cols.findIndex(end=>end<=it.top);if(c<0){c=cols.length;cols.push(0);}cols[c]=it.bottom;it.col=c;}for(const it of cluster){it.cols=cols.length;it.span=1;for(let c=it.col+1;c<cols.length;c++){if(cluster.some(o=>o.col===c&&o.top<it.bottom&&o.bottom>it.top))break;it.span++;}}out.push(...cluster);cluster=[];reach=-1;};
    for(const it of items){if(cluster.length&&it.top>=reach)flush();cluster.push(it);reach=Math.max(reach,it.bottom);}
    if(cluster.length)flush();
    return out;
  }
  // Events of the all-day row across a run of days as bars: first and last column, whether the bar goes on before or after
  // the run, and a lane; longer bars take the upper lanes, as in Google and Apple.
  function spanLayout(events,days){
    const first=days[0],last=days[days.length-1];
    const bars=events.map(e=>{const s=localKey(e.start);const end=e.allDay?(String(e.end||'').slice(0,10)||dayOffset(s,1)):dateKey(new Date(new Date(e.end||e.start).getTime()-1));const lastDay=e.allDay?dayOffset(end,-1):end;if(lastDay<first||s>last)return null;const from=s<first?first:s,to=lastDay>last?last:lastDay;return {event:e,from:days.indexOf(from),to:days.indexOf(to),before:s<first,after:lastDay>last};}).filter(b=>b&&b.from>=0&&b.to>=b.from);
    bars.sort((a,b)=>a.from-b.from||(b.to-b.from)-(a.to-a.from)||String(a.event.title||'').localeCompare(String(b.event.title||'')));
    const lanes=[];for(const b of bars){let lane=lanes.findIndex(end=>end<b.from);if(lane<0){lane=lanes.length;lanes.push(-1);}lanes[lane]=b.to;b.lane=lane;}
    return {bars,lanes:lanes.length};
  }
  // A timed event moved to start at key + minutes keeps its length.
  // One end of an event dragged to another day (2026-11-08 owner: 「일정을 잡고 옆으로 늘리면 늘린 날까지 그 일정이 이어지고」): the other end stays.
  // All day: never under one day. With times: the day moves and the clock stays, and an end never comes before its start.
  function stretchedEvent(event,side,day){
    if(event.allDay){const first=String(event.start).slice(0,10),end=String(event.end||'').slice(0,10)||dayOffset(first,1),last=dayOffset(end,-1);return side==='end'?{start:event.start,end:dayOffset(day<first?first:day,1)}:{start:day>last?last:day,end};}
    const s=new Date(event.start),en=new Date(event.end||event.start);const moved=(at,days)=>{const t=new Date(at);/* no days, no change: setDate would pick the first of an hour that comes twice (Codex recheck N3) */if(days)t.setDate(t.getDate()+days);return t;};const between=(a,b)=>Math.round((fromDate(b)-fromDate(a))/86400000);
    /* a clock that would end before it starts on that day: an hour, as a new event (Argon recheck GN2: 18:00 to 10:00 could not be drawn back to one day) */
    if(side==='end'){const next=moved(en,between(dateKey(new Date(en.getTime()-1)),day));return {start:event.start,end:(next>s?next:new Date(s.getTime()+3600000)).toISOString()};}
    const next=moved(s,between(dateKey(s),day));return {start:(next<en?next:new Date(en.getTime()-3600000)).toISOString(),end:en.toISOString()};
  }
  function movedTimes(event,key,minutes){const s=new Date(event.start),e=new Date(event.end||event.start);const start=atWall(key,minutes);return {start:start.toISOString(),end:new Date(start.getTime()+Math.max(0,e-s)).toISOString()};}
  // Dropped on another day (month grid, all-day row): the same clock time (timed) or the same number of days (all-day).
  function shiftedDays(event,days){
    if(event.allDay){const s=String(event.start).slice(0,10),e=String(event.end||'').slice(0,10)||dayOffset(s,1);return {start:dayOffset(s,days),end:dayOffset(e,days)};}
    const move=v=>{const d=new Date(v);d.setDate(d.getDate()+days);return d.toISOString();};
    return {start:move(event.start),end:move(event.end||event.start)};
  }
  // 42 days from a Sunday; outside marks days not in the month being looked at (the month of the grid's middle week).
  function cellsFrom(startKey){const focus=dayOffset(startKey,20).slice(0,7);return Array.from({length:42},(_,i)=>{const key=dayOffset(startKey,i);return {key,day:Number(key.slice(8)),outside:key.slice(0,7)!==focus};});}
  const monthStart=date=>{const first=dateKey(new Date(date.getFullYear(),date.getMonth(),1));return weekStart(first);};
  // Moving a whole repeating series to another day moves its days too (Google, Apple): weekly days shift by the same number
  // of days (and so does the week start of a rule every 2+ weeks, or days would cross into the other week), "the 2nd Tuesday"
  // becomes the new date's place in its month, a fixed day of the month becomes the new day, and an end date moves with the
  // series (2026-10-21 calendar review: the last instance fell past UNTIL). Daily and yearly days follow the start by
  // themselves. Returns the rule text unchanged when nothing has to move.
  function shiftRule(text,fromStart,toStart){
    const rule=parseRRule(text);if(!rule)return text;
    const from=localKey(fromStart),to=localKey(toStart);
    const delta=Math.round((fromDate(to)-fromDate(from))/86400000);if(!delta)return text;
    const d=fromDate(to);
    if(rule.until)rule.until=rule.until.length===8?dayOffset(`${rule.until.slice(0,4)}-${rule.until.slice(4,6)}-${rule.until.slice(6,8)}`,delta).replace(/-/g,''):new Date(untilBound(rule.until,false).getTime()+delta*86400000).toISOString().replace(/[-:]|\.\d{3}/g,'');
    if(rule.freq==='WEEKLY'&&rule.byDay.length){rule.byDay=rule.byDay.map(x=>({ord:x.ord,day:((x.day+delta)%7+7)%7}));if(rule.interval>1)rule.wkst=((rule.wkst+delta)%7+7)%7;}
    else if(rule.freq==='MONTHLY'&&rule.byDay.some(x=>x.ord)){const nth=Math.ceil(d.getDate()/7),isLast=d.getDate()+7>daysInMonth(d.getFullYear(),d.getMonth());const wasLast=rule.byDay.some(x=>x.ord===-1);rule.byDay=[{ord:(wasLast&&isLast)||nth===5?-1:nth,day:d.getDay()}];}
    else if(rule.freq==='MONTHLY'&&rule.byDay.length){rule.byDay=rule.byDay.map(x=>({ord:0,day:((x.day+delta)%7+7)%7}));}
    else if(rule.freq==='MONTHLY'&&rule.byMonthDay){rule.byMonthDay=d.getDate();}
    else if(!rule.until)return text;
    return buildRRule(rule);
  }
  // The recurrence id of a series' instance by its place in the series (EXDATEs counted, as COUNT counts them), or null.
  function instanceId(event,index){let found=null;if(index<0)return null;walkRRule(event,(o,i)=>{if(i===index){found=event.allDay?dateKey(o):o.toISOString();return false;}return i<index;});return found;}
  // Which Apple scopes a change to a repeating event may be saved with: 이 일정만 (one), 이후 모든 일정 (future), 모든 일정 (all).
  // 하루 종일 on or off applies to one occurrence only; a connected calendar's series moves to another day as one occurrence only
  // (the service would keep its weekdays on a moved start); a local monthly or yearly series moves to another day only from here
  // on (its days would be recomputed from the first one's month); a changed rule cannot go to one occurrence. main.cjs
  // event:update refuses the rest, the event card (calendar.js calScopeLabels) and the widget's edit dialog (app.js eventDialog)
  // offer only these — one rule for the three (2026-10-27 review). facts: provider (a connected calendar), dayChanged (the start
  // moves to another local day), flip (하루 종일 changes), ruleChanged (the repeat rule is in the change).
  function scopeChoices(event,{provider=false,dayChanged=false,flip=false,ruleChanged=false}={}){
    const onlyOne=Boolean(flip)||(Boolean(provider)&&Boolean(dayChanged));
    const monthly=!provider&&Boolean(dayChanged)&&!ruleChanged&&['MONTHLY','YEARLY'].includes(parseRRule(event?.rrule||'')?.freq);
    return {one:!ruleChanged,future:!onlyOne,all:!onlyOne&&!monthly};
  }
  const api={RANGE,SHORTCUT_MAX,SHORTCUT_KEEP,applyShortcut,cleanShortcuts,shortcutKey,shortcutProblem,shortcutValue,shortcutFromValue,stretchedEvent,nextDueOf,stepsDueOn,hexToHsv,hsvToHex,appPassword,parseQuickLine,parseEvent,parseEventEn,dateKey,weekStart,weekDays,wallMinutes,atWall,snapMinutes,spansDays,dayLayout,spanLayout,movedTimes,shiftedDays,cellsFrom,monthStart,shiftRule,instanceId,eventDate,fromDate,dayOffset,defaultEventTimes,followStart,inDay,matches,monthCells,LIST_ICONS,LIST_PALETTE,splitEmoji,autoColor,parseRRule,buildRRule,untilBefore,walkRRule,expandEvent,seriesPosition,eventsInRange,touchesRange,RRULE_DAYS,calendarWritable,defaultCalendarId,taskList,autoListId,accountCount,localCalendarHidden,sectionKey,orderLists,visibleState,builtInList,glassTint,glassTone,glassLook,glassLookApp,widgetTheme,isCustomColor,clampColor,titleColor,glassInks,inkOn,keepOneVisible,hidingRefusal,parseQuickKo,parseQuickEn,parseEventKo,localKey,WIDGET_MIN,WIDGET_OPEN,widgetMinimum,TEXT_SIZES,TEXT_SIZE_STEPS,textScale,textSizeStep,CAL_PANEL_WIDTH,CONTACT_EMAIL,SYNC_MONTHS,HISTORY_MONTHS,syncWindow,historyWindow,historyChunks,panelWidth,scrollThumb,scopeChoices,parseGoDate,TASK_SORTS,sortTasks,dueTimeOk,dueAt,TASK_ALERTS,alertBefore,defaultDueTime,nextDue,ruleAfter,ALERTS_TIMED,ALERTS_ALLDAY,alertOk,alertTime,firstOccurrence};
  if(typeof module!=='undefined')module.exports=api;
  else root.DayboardDates=api;
})(typeof window!=='undefined'?window:globalThis);
