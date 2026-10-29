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
  const WIDGET_MIN={calendar:{minWidth:300,minHeight:360},tasks:{minWidth:280,minHeight:240},note:{minWidth:280,minHeight:220}};
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
  // The look of a widget's glass on the wallpaper at a glass level: the tint (its colour and strength in the filter), the text tone
  // and the blur and saturation. Up to the slider's middle it follows the wallpaper as before (glassTint, the wallpaper's tone —
  // the text must read on what shows through). From the middle to the opaque end it moves step by step toward the app theme's own
  // card, white in light mode and dark in dark mode (2026-10-28 user: 「화이트 모드로 … 불투명한걸로 선택했다면 하얗게 나와야」 and
  // 「투명도 %에 따라서 조금씩 … 특정 구간을 지나면 갑자기 확 투명해지거나 하얗게 되는 게 아니라」): the tint's colour and strength
  // are blended linearly, so each step lightens or darkens the glass a little. Only the text colour changes at once, where the glass
  // crosses from dark to light, and the step or two where neither text colour would read (between GLASS_DARK_MAX and
  // GLASS_LIGHT_MIN, the limits tests/lists.test.cjs holds the glass to) are passed over. `spread` is the wallpaper's luminance
  // {mean, low, high} (app.js backdropLuminance); null when nothing is painted (the caller then uses the theme). `previous` is the
  // text tone shown so far: inside the passed-over gap the glass keeps to that tone's edge while it is at most GLASS_HOLD (a share
  // of the way: about .05 of wallpaper brightness, like glassTone's band) farther than the nearer edge, so a widget moved along the boundary does not flip its text back
  // and forth (2026-10-28 review; app.js passes it only for the same wallpaper, theme and level — the slider and a new wallpaper get
  // the nearer edge). Both edges read, so this costs no contrast; a narrow hold keeps a spot looking the same after a restart.
  const GLASS_SLATE=[0.145,0.153,0.18],GLASS_WHITE=[1,1,1],GLASS_DARK_MAX=0.42,GLASS_LIGHT_MIN=0.48,GLASS_HOLD=0.02,GLASS_INK_LIGHT=1,GLASS_INK_DARK=0.2;
  function glassLook(level,spread,wall,theme,previous){
    if(!spread||typeof spread.mean!=='number'||!Number.isFinite(spread.mean)||(wall!=='dark'&&wall!=='light'))return null;
    const g=typeof level==='number'&&Number.isFinite(level)?Math.min(1,Math.max(0,level)):0.5;
    const low=Number.isFinite(spread.low)?spread.low:spread.mean,high=Number.isFinite(spread.high)?spread.high:spread.mean;
    const luma=c=>0.2126*c[0]+0.7152*c[1]+0.0722*c[2];
    const over=(L,x)=>L*(1-x.t)+x.t*luma(x.c);
    const wallAt=x=>{const k=glassTint(x,wall==='dark'?high:low);return wall==='dark'?{t:k.da,c:GLASS_SLATE}:{t:k.a,c:GLASS_WHITE};};
    const now=glassTint(g,wall==='dark'?high:low);
    // How strongly the text and accents are drawn (glassInks): 0 on white glass (light) or glass darker than .2 (dark), rising as the
    // glass nears the change of text colour to 1 at the gap's edge — continuous, so they too change a little per step (2026-10-28
    // review: an on/off class turned the check circles black and the red month dark in one step). From the first dimming of white
    // glass, so a yellow check circle or the orange flag is never fainter on the glass than on the app's own card (tests); the dark
    // ramp starts at .2, not .3, so it spans more than one slider step (re-review: .3 to .42 moved the accents ~2/3 in one step). Every level.
    const ink=(x,tone)=>{const v=tone==='light'?(GLASS_INK_LIGHT-over(low,x))/(GLASS_INK_LIGHT-GLASS_LIGHT_MIN):(over(high,x)-GLASS_INK_DARK)/(GLASS_DARK_MAX-GLASS_INK_DARK);return +Math.min(1,Math.max(0,v)).toFixed(3);};
    // The saturation boost (which keeps the wallpaper's colour through the tint) fades over the first third of the way: kept up to
    // where the text colour changes, a vivid colour under a lightening tint sank the text (tests/lists.test.cjs).
    const look=(x,tone,w=0)=>{const sat=tone==='dark'?now.dsat:now.sat,k=ink(x,tone);return {tone,t:+x.t.toFixed(4),tint:x.c.map(v=>+v.toFixed(4)),sat:Math.round(sat+(100-sat)*Math.min(1,w*3)),blur:now.blur,solid:now.solid,ink:k,mid:k>0};};
    if(g<=0.5)return look(wallAt(g),wall);
    const own=theme==='dark'?'dark':'light';
    const from=wallAt(0.5),to={t:0.97,c:own==='dark'?GLASS_SLATE:GLASS_WHITE}; // next to the solid card (2026-10-28 review: dark stayed charcoal)
    // The tint at a share w of the way: strength and premultiplied colour blended, so the glass over any pixel moves in a line.
    const at=w=>{const t=from.t+(to.t-from.t)*w;const p=[0,1,2].map(i=>from.t*from.c[i]+(to.t*to.c[i]-from.t*from.c[i])*w);return {t,c:t>0?p.map(v=>Math.min(1,Math.max(0,v/t))):GLASS_WHITE};};
    const reads=x=>({dark:over(high,x)<=GLASS_DARK_MAX+1e-9,light:over(low,x)>=GLASS_LIGHT_MIN-1e-9});
    let w=(g-0.5)/0.5,x=at(w),r=reads(x);
    if(!r.dark&&!r.light){
      // The nearer share where one text colour reads again (the glass over a pixel is a line in w, so each edge is one division).
      const edge=(L,limit)=>{const a=over(L,at(0)),b=over(L,at(1))-a;if(Math.abs(b)<1e-9)return null;const e=(limit-a)/b;return e>=0&&e<=1?e:null;};
      const edges=[{tone:'dark',w:edge(high,GLASS_DARK_MAX)},{tone:'light',w:edge(low,GLASS_LIGHT_MIN)}].filter(e=>e.w!==null);
      const near=edges.sort((p,q)=>Math.abs(p.w-w)-Math.abs(q.w-w))[0],held=edges.find(e=>e.tone===previous);
      const pick=held&&Math.abs(held.w-w)<=Math.abs(near.w-w)+GLASS_HOLD?held:near;
      if(pick){w=pick.w;x=at(w);r=reads(x);}
    }
    const tone=r.light&&!r.dark?'light':r.dark&&!r.light?'dark':(over(spread.mean,x)>=0.5?'light':'dark');
    return look(x,tone,w);
  }
  // The widget text and accents on glass of a tone at an ink strength (glassLook ink): each between its plain colour (glass well
  // inside the tone, styles.css's own values) and its strong one (at the gap's edge: pure black or white text, secondary nearly as
  // strong, accents mixed by inkOn strong, check circles and + nearly monochrome as on Apple's clear widgets), as the CSS variables
  // app.js applyGlass sets on the widget body. tests/lists.test.cjs checks every step of the glass with these.
  const GLASS_INKS={
    light:{plain:{text:'#1c1d22',second:[44,48,60,0.82],third:[44,48,60,0.7],red:'#c4372b',note:'#8a6604',dot:'#2a5fc4',flag:'#ff9500',check:[65,'#3a3f4a'],plus:[70,'#000000']},
      strong:{text:'#000000',second:[0,0,0,0.9],third:[0,0,0,0.78],red:'#4e1611',note:'#372902',dot:'#11264e',flag:'#402500',check:[20,'#000000'],plus:[20,'#000000']}},
    dark:{plain:{text:'#f3f4f7',second:[236,238,245,0.84],third:[236,238,245,0.72],red:'#ff8f84',note:'#f6cf5c',dot:'#9dbdff',flag:'#ff9500',check:[45,'#ffffff'],plus:[45,'#ffffff']},
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
  function parseQuickKo(raw,today=dateKey(),now=new Date()){
    const text=String(raw||'').trim();let result={title:text,dueDate:'',reminderAt:''};
    // A date word may run straight into the time or a digit (「내일오후3시」, 「내일3시」) and M/D is a date too (2026-10-26 usability review).
    const m=text.match(/(^|\s)((다음|이번|담)\s?주\s?([월화수목금토일])요일|오늘|내일|모레|다음\s?주|담주|([월화수목금토일])요일|(\d{1,2})월\s?(\d{1,2})일|(\d{1,2})\/(\d{1,2}))(?:까지|에는|에|엔)?(?=\s|$|오전|오후|\d)/);
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
      if(date)result={title:quickStrip(text,m)||text,dueDate:date,reminderAt:''};
    }
    // 「15시」 is 24-hour; a bare 「3시」 reads like a bare 「3:00」 (quickClock) — the event card accepts both, so quick add does too
    // (2026-10-26 usability review; 「3시간」 stays a word).
    const t=result.title.match(/(^|\s)(?:(오전|오후)\s?(\d{1,2})시(?:\s?(반|\d{1,2}분))?|(\d{1,2})시(?:\s?(반|\d{1,2}분))?|([01]?\d|2[0-3]):([0-5]\d))(?:까지|에)?(?=\s|$)/);
    if(!t||repeatBefore(result.title,t))return result;
    const mins=v=>!v?0:v==='반'?30:parseInt(v,10);
    if(t[2]){
      const h12=Number(t[3]);if(h12<1||h12>12)return result;
      return quickTime(result,t,(h12%12)+(t[2]==='오후'?12:0),mins(t[4]),today,now);
    }
    if(t[5]){
      const hour=Number(t[5]);if(hour>23)return result;
      return hour>=13||hour===0||/^0/.test(t[5])?quickTime(result,t,hour,mins(t[6]),today,now):quickClock(result,t,t[5],hour,mins(t[6]),today,now);
    }
    return quickClock(result,t,t[7],Number(t[7]),Number(t[8]),today,now);
  }
  const QUICK_WEEK_EN=['sun','mon','tue','wed','thu','fri','sat'];
  const QUICK_MONTHS_EN=['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];
  const QUICK_WD_EN='sun(?:day)?|mon(?:day)?|tue(?:s|sday)?|wed(?:nesday)?|thu(?:rs|rsday)?|fri(?:day)?|sat(?:urday)?';
  const QUICK_DATE_EN=new RegExp(String.raw`(^|\s)(?:(?:by|on|due)\s+)?((next|this)\s+(${QUICK_WD_EN})|today|tomorrow|next\s?week|(${QUICK_WD_EN})|(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.?\s?(\d{1,2})(?:st|nd|rd|th)?|(\d{1,2})\/(\d{1,2}))(?=\s|$)`,'i');
  // "tomorrow dentist", "next friday report", "due oct 25 wedding", "10/25 trip", "call mom 3pm".
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
      if(date)result={title:quickStrip(text,m)||text,dueDate:date,reminderAt:''};
    }
    // "at 3" reads like Korean 「3시」 (bare-clock rule), noon/midnight are 12:00/00:00; a bare "3" after a date word stays a word
    // ("tomorrow 3 reports", 2026-10-27 review).
    const t=result.title.match(/(^|\s)(?:at\s+)?(?:(\d{1,2})(?::([0-5]\d))?\s?(am|pm)|([01]?\d|2[0-3]):([0-5]\d)|(noon|midnight)|at\s+(\d{1,2}))(?=\s|$)/i);
    if(!t||repeatBefore(result.title,t))return result;
    if(t[4]){
      const h12=Number(t[2]);if(h12<1||h12>12)return result;
      return quickTime(result,t,(h12%12)+(t[4].toLowerCase()==='pm'?12:0),t[3]?Number(t[3]):0,today,now);
    }
    if(t[7])return quickTime(result,t,t[7].toLowerCase()==='noon'?12:0,0,today,now);
    if(t[8]){
      const hour=Number(t[8]);if(hour>23)return result;
      return hour>=13||hour===0||/^0/.test(t[8])?quickTime(result,t,hour,0,today,now):quickClock(result,t,t[8],hour,0,today,now);
    }
    return quickClock(result,t,t[5],Number(t[5]),Number(t[6]),today,now);
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
  const api={dateKey,weekStart,weekDays,wallMinutes,atWall,snapMinutes,spansDays,dayLayout,spanLayout,movedTimes,shiftedDays,cellsFrom,monthStart,shiftRule,instanceId,eventDate,fromDate,dayOffset,defaultEventTimes,followStart,inDay,matches,monthCells,LIST_ICONS,LIST_PALETTE,splitEmoji,autoColor,parseRRule,buildRRule,untilBefore,walkRRule,expandEvent,seriesPosition,eventsInRange,touchesRange,RRULE_DAYS,calendarWritable,defaultCalendarId,taskList,autoListId,accountCount,localCalendarHidden,sectionKey,visibleState,builtInList,glassTint,glassTone,glassLook,glassInks,inkOn,keepOneVisible,hidingRefusal,parseQuickKo,parseQuickEn,localKey,WIDGET_MIN,scopeChoices,parseGoDate,TASK_SORTS,sortTasks,nextDue,ruleAfter,ALERTS_TIMED,ALERTS_ALLDAY,alertOk,alertTime,firstOccurrence};
  if(typeof module!=='undefined')module.exports=api;
  else root.DayboardDates=api;
})(typeof window!=='undefined'?window:globalThis);
