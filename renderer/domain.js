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
  function matches(t,view,today=dateKey()){
    if(view==='today')return !!t.dueDate&&t.dueDate<=today;
    if(view==='planned')return !!t.dueDate;
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
      strong:{text:'#000000',second:[0,0,0,0.9],third:[0,0,0,0.78],red:'#a8221a',note:'#372902',dot:'#11264e',flag:'#402500',check:[20,'#000000'],plus:[20,'#000000']}},
    dark:{plain:{text:'#f3f4f7',second:[236,238,245,0.84],third:[236,238,245,0.72],red:'#ff453a',note:'#f6cf5c',dot:'#9dbdff',flag:'#ff9500',check:[45,'#ffffff'],plus:[45,'#ffffff']},
      strong:{text:'#ffffff',second:[255,255,255,0.92],third:[255,255,255,0.8],red:'#ffe3e0',note:'#fbe7ae',dot:'#dde8ff',flag:'#ffe5bf',check:[35,'#ffffff'],plus:[35,'#ffffff']}}};
  function glassInks(tone,ink){
    const set=GLASS_INKS[tone==='dark'?'dark':'light'],k=Math.min(1,Math.max(0,Number(ink)||0)),p=set.plain,q=set.strong;
    const rgb=h=>[1,3,5].map(i=>parseInt(h.slice(i,i+2),16)),lerp=(a,b)=>a+(b-a)*k;
    const hex=(a,b)=>{const x=rgb(a),y=rgb(b);return '#'+[0,1,2].map(i=>Math.round(lerp(x[i],y[i])).toString(16).padStart(2,'0')).join('');};
    const rgba=(a,b)=>`rgba(${[0,1,2].map(i=>Math.round(lerp(a[i],b[i]))).join(',')},${+lerp(a[3],b[3]).toFixed(3)})`;
    return {'--w-text':hex(p.text,q.text),'--w-secondary':rgba(p.second,q.second),'--w-tertiary':rgba(p.third,q.third),'--w-red':hex(p.red,q.red),
      '--w-note':hex(p.note,q.note),'--w-dot':hex(p.dot,q.dot),'--w-flag':hex(p.flag,q.flag),
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
    return {title:quickStrip(result.title,m)||result.title,dueDate:day,reminderAt:when.toISOString()};
  }
  // "3:30" with no 오전/오후 (am/pm) and no leading zero can be either time (2026-10-20 review: "3:30 회의" typed at
  // 14:00 became 03:30 tomorrow): today it is the next one still ahead; on a later day the daytime reading wins
  // (1–6 afternoon, 7–11 morning). "03:30" and 13–23 stay 24-hour.
  function quickClock(result,m,written,hour,minute,today,now){
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
  function parseQuickKo(raw,today=dateKey(),now=new Date()){
    const text=String(raw||'').trim();let result={title:text,dueDate:'',reminderAt:''};
    // A date word may run straight into the time or a digit (「내일오후3시」, 「내일3시」, 「내일밤11시」) and M/D is a date too (2026-10-26 usability review).
    const m=text.match(/(^|\s)((다음|이번|담)\s?주\s?([월화수목금토일])요일|오늘|내일|모레|다음\s?주|담주|([월화수목금토일])요일|(\d{1,2})월\s?(\d{1,2})일|(\d{1,2})\/(\d{1,2})|(다음|이번)\s?달\s?(\d{1,2})일)(?:까지|에는|에|엔)?(?=\s|$|새벽|아침|오전|낮|오후|저녁|밤|정오|자정|\d)/);
    if(m&&repeatBefore(text,m))return result;
    if(m){
      const token=m[2].replace(/\s/g,'');let date='';
      if(m[4])date=quickWeekDay(today,m[3]==='이번'?0:1,QUICK_WEEK_KO.indexOf(m[4]));
      else if(token==='오늘')date=today;
      else if(token==='내일')date=dayOffset(today,1);
      else if(token==='모레')date=dayOffset(today,2);
      else if(token==='다음주'||token==='담주')date=dayOffset(today,7);
      else if(m[5])date=quickNextDay(today,QUICK_WEEK_KO.indexOf(m[5]));
      else if(m[6])date=quickMonthDay(today,Number(m[6]),Number(m[7]));
      else if(m[8])date=quickMonthDay(today,Number(m[8]),Number(m[9]));
      else if(m[10])date=(m[10]==='다음'?quickNextMonth:quickThisMonth)(today,Number(m[11]));
      if(date)result={title:quickStrip(text,m)||text,dueDate:date,reminderAt:''};
    }
    // 「15시」 is 24-hour; a bare 「3시」 reads like a bare 「3:00」 (quickClock) — the event card accepts both, so quick add does too
    // (2026-10-26 usability review; 「3시간」 stays a word). A period word (PERIOD_KO, also before H:MM: 「밤 11:30」) or 정오/자정 is part of the
    // match, so it leaves the title and never reaches quickClock.
    const t=result.title.match(/(^|\s)(?:(새벽|아침|오전|낮|오후|저녁|밤)\s?(\d{1,2})(?:시(?:\s?(반|\d{1,2}분))?|:([0-5]\d))|(\d{1,2})시(?:\s?(반|\d{1,2}분))?|([01]?\d|2[0-3]):([0-5]\d)|(정오|자정))(?:까지|에)?(?=\s|$)/);
    if(!t||repeatBefore(result.title,t))return result;
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
  const QUICK_DATE_EN=new RegExp(String.raw`(^|\s)(?:(?:by|on|due)\s+)?((next|this)\s+(${QUICK_WD_EN})|today|tomorrow|next\s?week|(${QUICK_WD_EN})|(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.?\s?(\d{1,2})(?:st|nd|rd|th)?|(\d{1,2})\/(\d{1,2})|(next|this)\s+month\s+(\d{1,2})(?:st|nd|rd|th)?)(?=\s|$)`,'i');
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
  const QUICK_TIME_EN=new RegExp(String.raw`(^|\s)(?:at\s+)?(?:(?:in\s+the\s+)?(${QUICK_PERIOD_EN}|(?:evening|afternoon|morning|night)(?=\s+at\s))\s+(?:at\s+)?(\d{1,2})(?::([0-5]\d))?(?:\s?(am|pm))?|(\d{1,2})(?::([0-5]\d))?(?:\s?(am|pm))?\s+(${QUICK_PERIOD_EN}|${QUICK_AFTER_EN})|(\d{1,2})(?::([0-5]\d))?\s?(am|pm)|([01]?\d|2[0-3]):([0-5]\d)|(noon|midnight)|at\s+(\d{1,2}))(?=\s|$)`,'i');
  // "tomorrow dentist", "next friday report", "due oct 25 wedding", "10/25 trip", "call mom 3pm", "next month 1 rent".
  function parseQuickEn(raw,today=dateKey(),now=new Date()){
    const text=String(raw||'').trim();let result={title:text,dueDate:'',reminderAt:''};
    const m=text.match(QUICK_DATE_EN);
    if(m&&repeatBefore(text,m))return result;
    if(m){
      const token=m[2].toLowerCase().replace(/\s/g,'');let date='';
      if(m[4])date=quickWeekDay(today,m[3].toLowerCase()==='this'?0:1,QUICK_WEEK_EN.indexOf(m[4].slice(0,3).toLowerCase()));
      else if(token==='today')date=today;
      else if(token==='tomorrow')date=dayOffset(today,1);
      else if(token==='nextweek')date=dayOffset(today,7);
      else if(m[5])date=quickNextDay(today,QUICK_WEEK_EN.indexOf(m[5].slice(0,3).toLowerCase()));
      else if(m[6])date=quickMonthDay(today,QUICK_MONTHS_EN.indexOf(m[6].slice(0,3).toLowerCase())+1,Number(m[7]));
      else if(m[8])date=quickMonthDay(today,Number(m[8]),Number(m[9]));
      else if(m[10])date=(m[10].toLowerCase()==='next'?quickNextMonth:quickThisMonth)(today,Number(m[11]));
      if(date)result={title:quickStrip(text,m)||text,dueDate:date,reminderAt:''};
    }
    // "at 3" reads like Korean 「3시」 (bare-clock rule), noon is 12:00 and midnight 00:00 of the next day (like 자정); a bare "3" after a
    // date word stays a word ("tomorrow 3 reports", 2026-10-27 review).
    const t=result.title.match(QUICK_TIME_EN);
    if(!t||repeatBefore(result.title,t))return result;
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
  function sortTasks(tasks,mode,order,locale,importantOf=t=>t.important){
    const byDue=(a,b)=>(a.dueDate||'9999').localeCompare(b.dueDate||'9999');
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
  // ---- Repeating tasks (Reminders, To Do): completing one adds the next, dated the rule's first day after its due date (not
  // after the day it was done — To Do and Reminders count from the due date). '' when the rule has ended (UNTIL, COUNT).
  function nextDue(rruleText,dueKey){
    if(!/^\d{4}-\d{2}-\d{2}$/.test(String(dueKey||''))||!parseRRule(rruleText))return '';
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
  function defaultEventTimes(day,now=new Date()){
    if(day!==dateKey(now)||now.getHours()<9)return [day+'T09:00',day+'T10:00'];
    const local=d=>`${dateKey(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
    const s=new Date(now);s.setHours(Math.min(now.getHours()+1,23),0,0,0);const e=new Date(s);e.setHours(e.getHours()+1);
    return [local(s),local(e)];
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
  const api={dateKey,weekStart,weekDays,wallMinutes,atWall,snapMinutes,spansDays,dayLayout,spanLayout,movedTimes,shiftedDays,cellsFrom,monthStart,shiftRule,instanceId,eventDate,fromDate,dayOffset,defaultEventTimes,followStart,inDay,matches,monthCells,LIST_ICONS,LIST_PALETTE,splitEmoji,autoColor,parseRRule,buildRRule,untilBefore,walkRRule,expandEvent,seriesPosition,eventsInRange,touchesRange,RRULE_DAYS,calendarWritable,defaultCalendarId,taskList,autoListId,accountCount,localCalendarHidden,sectionKey,orderLists,visibleState,builtInList,glassTint,glassTone,glassLook,glassLookApp,widgetTheme,isCustomColor,clampColor,titleColor,glassInks,inkOn,keepOneVisible,hidingRefusal,parseQuickKo,parseQuickEn,localKey,WIDGET_MIN,WIDGET_OPEN,widgetMinimum,TEXT_SIZES,TEXT_SIZE_STEPS,textScale,textSizeStep,CAL_PANEL_WIDTH,CONTACT_EMAIL,SYNC_MONTHS,HISTORY_MONTHS,syncWindow,historyWindow,historyChunks,panelWidth,scrollThumb,scopeChoices,parseGoDate,TASK_SORTS,sortTasks,nextDue,ruleAfter,ALERTS_TIMED,ALERTS_ALLDAY,alertOk,alertTime,firstOccurrence};
  if(typeof module!=='undefined')module.exports=api;
  else root.DayboardDates=api;
})(typeof window!=='undefined'?window:globalThis);
