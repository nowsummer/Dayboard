/* Browser-only local preview. The installed app always uses the isolated preload API. */
(function(){
 if(window.dayboard)return;
 const {dateKey,dayOffset}=window.DayboardDates, today=dateKey();
 const blank=()=>({version:1,lists:[{id:'local-inbox',name:'나의 할 일',color:'#3478f6',provider:'local'}],tasks:[],calendars:[{id:'local-calendar',name:'나의 달력',color:'#ff9f0a',provider:'local'}],events:[],notes:[],accounts:[],widgets:[],groups:[],settings:{theme:'light',widgetOpacity:0.94,widgetMode:'desktop',launchAtLogin:false,collapsedSections:[],timeFormat:'12h',language:'system',hiddenCalendars:[]},sync:{busy:false}});
 let s;try{s=JSON.parse(localStorage.getItem('dayboard-preview'));}catch{}
 if(!s)s=blank();
 const listeners=[]; const save=()=>{localStorage.setItem('dayboard-preview',JSON.stringify(s));listeners.forEach(f=>f(structuredClone(s)));};
 const id=()=>crypto.randomUUID();
 function seed(){
  if(s.tasks.length)return;
  s.lists.push({id:'preview-personal',name:'개인',color:'#b06ce7',provider:'local'});
  s.tasks=[['주간 보고서 마무리','local-inbox',today,true],['오후 회의 자료 검토','local-inbox',today,false],['퇴근길에 장보기','preview-personal',today,false],['이번 주 운동 일정 정하기','preview-personal',dayOffset(today,1),false],['주말 여행 계획하기','preview-personal','',false]].map((r,i)=>({id:'sample-'+i,title:r[0],listId:r[1],dueDate:r[2],important:r[3],completed:false,notes:'',createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()}));
  s.events=[{id:'preview-event',title:'팀 미팅',start:today+'T14:00:00',end:today+'T15:00:00',allDay:false,calendarId:'local-calendar',provider:'local',location:'회의실'}];
  s.notes=[{id:'preview-note',title:'오늘의 생각',body:'조금씩, 꾸준히.\n\n오늘 꼭 기억하고 싶은 것을\n이곳에 남겨보세요.',color:'yellow',updatedAt:new Date().toISOString()}];save();
 }
 if(new URLSearchParams(location.search).has('preview'))seed();
 window.dayboard={isPreview:true,subscribe:f=>{listeners.push(f);return()=>listeners.splice(listeners.indexOf(f),1);},invoke:async(c,p={})=>{
  if(c==='state:get')return structuredClone(s);
  if(c==='task:add')s.tasks.push({id:id(),completed:false,important:false,notes:'',dueDate:'',createdAt:new Date().toISOString(),...p});
  else if(c==='task:update'){const t=s.tasks.find(x=>x.id===p.id);if(t)Object.assign(t,p);}
  else if(c==='task:delete')s.tasks=s.tasks.filter(t=>t.id!==p.id);
  else if(c==='list:add')s.lists.push({id:id(),provider:'local',...p});
  else if(c==='list:delete'){s.lists=s.lists.filter(l=>l.id!==p.id);s.tasks=s.tasks.filter(t=>t.listId!==p.id);}
  else if(c==='list:update'){const l=s.lists.find(x=>x.id===p.id);if(l){Object.assign(l,p);if(!p.groupId)delete l.groupId;}}
  else if(c==='group:add'){const g={id:id(),name:p.name,collapsed:false};(s.groups||(s.groups=[])).push(g);save();return g;}
  else if(c==='group:update'){const g=(s.groups||[]).find(x=>x.id===p.id);if(g)Object.assign(g,p);}
  else if(c==='group:delete'){s.groups=(s.groups||[]).filter(x=>x.id!==p.id);for(const l of s.lists)if(l.groupId===p.id)delete l.groupId;}
  else if(c==='note:save'){let n=s.notes.find(x=>x.id===p.id);if(n)Object.assign(n,p);else{s.notes.push(n={id:id(),...p});}save();return n;}
  else if(c==='note:delete')s.notes=s.notes.filter(x=>x.id!==p.id);
  else if(c==='event:add')s.events.push({id:id(),provider:'local',...p});
  else if(c==='event:delete')s.events=s.events.filter(x=>x.id!==p.id);
  else if(c==='settings:update')Object.assign(s.settings,p);
  else if(c==='account:update')return structuredClone(s);
  else if(c==='auth:status')return {microsoft:{builtIn:true},google:{builtIn:false},icloud:{builtIn:true}};
  else if(c==='event:update'){const ev=s.events.find(x=>x.id===p.id);if(ev)Object.assign(ev,p);}
  else if(c==='event:color'){const ev=s.events.find(x=>x.id===p.id);if(ev){if(p.color)ev.color=p.color;else delete ev.color;}}
  else if(c==='calendar:delete'){s.calendars=s.calendars.filter(x=>x.id!==p.id);s.events=s.events.filter(x=>x.calendarId!==p.id);}
  else if(c==='calendar:update'){const cal=s.calendars.find(x=>x.id===p.id);if(cal){if(p.color)cal.customColor=p.color;else delete cal.customColor;}}
  else if(c==='demo:load')seed();
  else if(c==='widget:open'){throw Error('바탕화면 위젯은 Windows용 Dayboard 앱에서 사용할 수 있어요.');}
  else if(c==='account:connect'||c==='sync:run')throw Error('화면 미리보기입니다. 계정 연결은 Windows 앱에서 진행하세요.');
  else if(c.startsWith('window:')||c==='widget:close')return;
  else if(c==='external:open'){window.open(p.url,'_blank','noopener');return;}
  else throw Error('이 기능은 Windows용 Dayboard 앱에서 사용할 수 있어요.');
  save();return structuredClone(s);
 }};
})();
