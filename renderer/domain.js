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
  // Walks the recurrence set in order and calls visit(startDate, index) for every generated instance
  // (EXDATEs included, as COUNT counts them). visit returns false to stop. Capped so a rule can never spin forever.
  function walkRRule(event,visit){
    const rule=parseRRule(event.rrule);if(!rule)return;
    const allDay=Boolean(event.allDay);
    const base=allDay?startOfLocalDay(String(event.start).slice(0,10)):new Date(event.start);
    if(!Number.isFinite(base.getTime()))return;
    const until=rule.until?untilBound(rule.until,allDay):null;
    const at=(y,m,d)=>new Date(y,m,d,base.getHours(),base.getMinutes(),base.getSeconds(),base.getMilliseconds());
    let produced=0,steps=0;const LIMIT=6000;
    const consider=o=>{
      if(o<base)return true;
      produced++;
      if(rule.count&&produced>rule.count)return false;
      if(until&&o>until)return false;
      return visit(o,produced-1)!==false;
    };
    if(rule.freq==='DAILY'){for(let i=0;steps++<LIMIT;i++){if(!consider(at(base.getFullYear(),base.getMonth(),base.getDate()+i*rule.interval)))return;}}
    else if(rule.freq==='WEEKLY'){
      const days=(rule.byDay.length?rule.byDay.map(d=>d.day):[base.getDay()]).filter((d,i,a)=>a.indexOf(d)===i).sort((a,b)=>((a-rule.wkst+7)%7)-((b-rule.wkst+7)%7));
      const weekStart=new Date(base.getFullYear(),base.getMonth(),base.getDate()-((base.getDay()-rule.wkst+7)%7));
      for(let w=0;steps++<LIMIT;w++)for(const d of days){if(!consider(at(weekStart.getFullYear(),weekStart.getMonth(),weekStart.getDate()+w*7*rule.interval+((d-rule.wkst+7)%7))))return;}
    }
    else if(rule.freq==='MONTHLY'){
      const ordinal=rule.byDay.find(d=>d.ord)||null;const weekdays=rule.byDay.filter(d=>!d.ord).map(d=>d.day);const mday=rule.byMonthDay||base.getDate();
      for(let k=0;steps++<LIMIT;k++){
        const first=new Date(base.getFullYear(),base.getMonth()+k*rule.interval,1);const y=first.getFullYear(),m=first.getMonth(),dim=daysInMonth(y,m);
        let dates=[];
        if(ordinal){const d=nthWeekday(y,m,ordinal.day,ordinal.ord);if(d)dates=[d];}
        else if(weekdays.length){for(let d=1;d<=dim;d++)if(weekdays.includes(new Date(y,m,d).getDay()))dates.push(d);}
        else{const d=mday>0?mday:dim+mday+1;if(d>=1&&d<=dim)dates=[d];}
        for(const d of dates){if(!consider(at(y,m,d)))return;}
      }
    }
    else{for(let k=0;steps++<LIMIT;k++){const y=base.getFullYear()+k*rule.interval,m=base.getMonth(),d=base.getDate();if(d>daysInMonth(y,m))continue;if(!consider(at(y,m,d)))return;}}
  }
  // Occurrences of a recurring master that touch [fromKey, toKey). Each occurrence is a full event object
  // whose id is "<masterId>@<recurrenceId>" so the UI can address one instance, with masterId/recurrenceId set.
  function expandEvent(event,fromKey,toKey){
    const allDay=Boolean(event.allDay);
    const base=allDay?startOfLocalDay(String(event.start).slice(0,10)):new Date(event.start);
    if(!Number.isFinite(base.getTime()))return [];
    const endBase=allDay?startOfLocalDay(String(event.end||'').slice(0,10)||dayOffset(String(event.start).slice(0,10),1)):new Date(event.end||event.start);
    const span=allDay?Math.max(1,Math.round((endBase-base)/86400000)):Math.max(0,endBase-base);
    const rangeStart=startOfLocalDay(fromKey).getTime(),rangeEnd=startOfLocalDay(toKey).getTime();
    const exdates=new Set(event.exdates||[]);
    const out=[];
    walkRRule(event,o=>{
      const startMs=o.getTime();if(startMs>=rangeEnd)return false;
      const endMs=allDay?startMs+span*86400000:startMs+span;
      const visible=endMs>startMs?endMs>rangeStart:startMs>=rangeStart;
      if(!visible)return true;
      const recurrenceId=allDay?dateKey(o):o.toISOString();
      if(exdates.has(recurrenceId)||exdates.has(dateKey(o)))return true;
      const start=allDay?recurrenceId:o.toISOString();
      const end=allDay?dayOffset(recurrenceId,span):new Date(endMs).toISOString();
      out.push({...event,id:`${event.id}@${recurrenceId}`,masterId:event.id,recurrenceId,start,end,occurrence:true});
      return true;
    });
    return out;
  }
  // Position of one occurrence inside its series: how many instances come before it, and how many COUNT leaves after it.
  function seriesPosition(event,recurrenceId){
    const rule=parseRRule(event.rrule);if(!rule)return null;
    let found=null;
    walkRRule(event,(o,index)=>{const rid=event.allDay?dateKey(o):o.toISOString();if(rid===recurrenceId||(event.allDay&&rid===String(recurrenceId).slice(0,10))){found={index,remaining:rule.count?rule.count-index:null};return false;}return index<20000;});
    return found;
  }
  function touchesRange(e,fromKey,toKey){
    if(e.allDay){const s=String(e.start).slice(0,10),en=String(e.end||'').slice(0,10)||dayOffset(s,1);return s<toKey&&en>fromKey;}
    const s=new Date(e.start),en=new Date(e.end||e.start),a=startOfLocalDay(fromKey),b=startOfLocalDay(toKey);
    return s<b&&(en>s?en>a:s>=a);
  }
  // Everything to draw between two day keys: plain events and exceptions as stored, recurring masters expanded.
  function eventsInRange(events,fromKey,toKey){
    const out=[];
    for(const e of events){if(e.rrule)out.push(...expandEvent(e,fromKey,toKey));else if(touchesRange(e,fromKey,toKey))out.push(e);}
    return out;
  }
  // ---- Calendars: where new events go, and when the local calendar steps back ----
  const calendarWritable=c=>Boolean(c)&&!c.readOnly;
  // Calendar for a new event: the user's choice while it exists and is writable, else the connected account's
  // primary calendar (Google primary / Outlook default calendar), else any writable account calendar, else this PC.
  function defaultCalendarId(state){
    const calendars=state.calendars||[];
    const chosen=calendars.find(c=>c.id===state.settings?.defaultCalendarId);
    if(calendarWritable(chosen))return chosen.id;
    const account=calendars.find(c=>c.provider!=='local'&&c.primary&&calendarWritable(c))||calendars.find(c=>c.provider!=='local'&&calendarWritable(c));
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
  // the solid alpha used without a wallpaper (always-on-top widgets). Level 0.5 is exactly the 2026-10-20 look;
  // every level keeps dark text readable because the tint is solved from the wallpaper's brightness.
  function glassTint(level,L){
    const g=typeof level==='number'&&Number.isFinite(level)?Math.min(1,Math.max(0,level)):0.5;
    const mix=(clear,mid,frost)=>g<=0.5?clear+(mid-clear)*(g/0.5):mid+(frost-mid)*((g-0.5)/0.5);
    const clamp=(v,lo,hi)=>Math.min(hi,Math.max(lo,v));
    const out={blur:Math.round(mix(14,26,34)),sat:Math.round(mix(190,175,150)),alpha:+mix(0.78,0.94,1).toFixed(3)};
    if(typeof L!=='number'||!Number.isFinite(L))return out;
    const target=mix(0.74,0.93,0.97),lo=mix(0.14,0.42,0.8),hi=mix(0.72,0.93,0.97);
    out.a=+clamp((target-L)/Math.max(0.05,1-L),lo,hi).toFixed(3);
    const dark=mix(0.32,0.17,0.15),dlo=mix(0.16,0.4,0.72),dhi=mix(0.66,0.86,0.94);
    out.da=+clamp(L>dark?(L-dark)/Math.max(0.05,L-0.12):dlo,dlo,dhi).toFixed(3);
    return out;
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
  function quickWeekDay(today,weeks,idx){const dow=fromDate(today).getDay();return dayOffset(today,-((dow+6)%7)+7*weeks+((idx+6)%7));}
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
    const m=text.match(/(^|\s)((다음|이번|담)\s?주\s?([월화수목금토일])요일|오늘|내일|모레|다음\s?주|담주|([월화수목금토일])요일|(\d{1,2})월\s?(\d{1,2})일)(?:까지|에는|에|엔)?(?=\s|$)/);
    if(m){
      const token=m[2].replace(/\s/g,'');let date='';
      if(m[4])date=quickWeekDay(today,m[3]==='이번'?0:1,QUICK_WEEK_KO.indexOf(m[4]));
      else if(token==='오늘')date=today;
      else if(token==='내일')date=dayOffset(today,1);
      else if(token==='모레')date=dayOffset(today,2);
      else if(token==='다음주'||token==='담주')date=dayOffset(today,7);
      else if(m[5])date=quickNextDay(today,QUICK_WEEK_KO.indexOf(m[5]));
      else if(m[6])date=quickMonthDay(today,Number(m[6]),Number(m[7]));
      if(date)result={title:quickStrip(text,m)||text,dueDate:date,reminderAt:''};
    }
    const t=result.title.match(/(^|\s)(?:(오전|오후)\s?(\d{1,2})시(?:\s?(반|\d{1,2}분))?|([01]?\d|2[0-3]):([0-5]\d))(?:까지|에)?(?=\s|$)/);
    if(!t)return result;
    if(t[2]){
      const h12=Number(t[3]);if(h12<1||h12>12)return result;
      const minute=!t[4]?0:t[4]==='반'?30:parseInt(t[4],10);
      return quickTime(result,t,(h12%12)+(t[2]==='오후'?12:0),minute,today,now);
    }
    return quickClock(result,t,t[5],Number(t[5]),Number(t[6]),today,now);
  }
  const QUICK_WEEK_EN=['sun','mon','tue','wed','thu','fri','sat'];
  const QUICK_MONTHS_EN=['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];
  const QUICK_WD_EN='sun(?:day)?|mon(?:day)?|tue(?:s|sday)?|wed(?:nesday)?|thu(?:rs|rsday)?|fri(?:day)?|sat(?:urday)?';
  const QUICK_DATE_EN=new RegExp(String.raw`(^|\s)(?:(?:by|on|due)\s+)?((next|this)\s+(${QUICK_WD_EN})|today|tomorrow|next\s?week|(${QUICK_WD_EN})|(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.?\s?(\d{1,2})(?:st|nd|rd|th)?|(\d{1,2})\/(\d{1,2}))(?=\s|$)`,'i');
  // "tomorrow dentist", "next friday report", "due oct 25 wedding", "10/25 trip", "call mom 3pm".
  function parseQuickEn(raw,today=dateKey(),now=new Date()){
    const text=String(raw||'').trim();let result={title:text,dueDate:'',reminderAt:''};
    const m=text.match(QUICK_DATE_EN);
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
    const t=result.title.match(/(^|\s)(?:at\s+)?(?:(\d{1,2})(?::([0-5]\d))?\s?(am|pm)|([01]?\d|2[0-3]):([0-5]\d))(?=\s|$)/i);
    if(!t)return result;
    if(t[4]){
      const h12=Number(t[2]);if(h12<1||h12>12)return result;
      return quickTime(result,t,(h12%12)+(t[4].toLowerCase()==='pm'?12:0),t[3]?Number(t[3]):0,today,now);
    }
    return quickClock(result,t,t[5],Number(t[5]),Number(t[6]),today,now);
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
  const api={dateKey,eventDate,fromDate,dayOffset,defaultEventTimes,followStart,inDay,matches,monthCells,LIST_ICONS,LIST_PALETTE,splitEmoji,autoColor,parseRRule,buildRRule,untilBefore,expandEvent,seriesPosition,eventsInRange,touchesRange,RRULE_DAYS,calendarWritable,defaultCalendarId,localCalendarHidden,sectionKey,visibleState,builtInList,glassTint,keepOneVisible,hidingRefusal,parseQuickKo,parseQuickEn};
  if(typeof module!=='undefined')module.exports=api;
  else root.DayboardDates=api;
})(typeof window!=='undefined'?window:globalThis);
