import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import model from './model.js';
import cloud from './cloud.js';
globalThis.PlannerModel=model;

test('deadline reminders include only own unfinished assignments due today/tomorrow and change at midnight',()=>{
 const state=model.createInitialState();
 state.notices=[
  ['today','2026-11-19','all','assignment'],['tomorrow','2026-11-20','all','assignment'],
  ['late','2026-11-18','all','assignment'],['later','2026-11-21','all','assignment'],
  ['other','2026-11-19','unknown','assignment'],['notice','2026-11-19','all','notice'],
  ['done','2026-11-19','all','assignment'],['undated','','all','assignment'],
 ].map(([id,dueDate,groupId,type])=>({id,dueDate,groupId,type,createdAt:'2026-11-01'}));
 state.completedNoticeIds=['done'];
 assert.deepEqual(model.deadlineReminders(state,new Date(2026,10,19)).map(n=>n.id),['today','tomorrow']);
 assert.deepEqual(model.deadlineReminders(state,new Date(2026,10,20)).map(n=>n.id),['tomorrow','later']);
 const ranked=model.sortByUrgency(model.visibleNotices(state),state.completedNoticeIds,new Date(2026,10,19));
 assert.deepEqual(ranked.slice(0,4).map(n=>n.id),['today','tomorrow','late','later']);
 assert.equal(ranked.at(-1).id,'done');
});

test('theme restores dark, saves light and ignores removed system option',()=>{
 const handlers={},storage=new Map([['planner-theme','dark']]);
 const media={matches:false,addEventListener:(event,fn)=>handlers[event]=fn};
 const element={dataset:{}};
 const root={addEventListener:(event,fn)=>handlers['root-'+event]=fn};
 const context=vm.createContext({PlannerModel:model,document:{documentElement:element,querySelector:()=>root},window:{addEventListener(){}},
  matchMedia:()=>media,localStorage:{getItem:k=>storage.get(k),setItem:(k,v)=>storage.set(k,v)}});
 vm.runInContext(readFileSync(new URL('./app.js',import.meta.url),'utf8'),context);
 assert.equal(element.dataset.theme,'dark');
 const choose=value=>handlers['root-change']({target:{value,matches:s=>s==='[data-theme-choice]'}});
 choose('system'); assert.equal(element.dataset.theme,'dark');
 assert.equal(handlers.change,undefined);
 choose('light'); assert.equal(element.dataset.theme,'light');
 assert.equal(storage.get('planner-theme'),'light');
});

test('importance sorts by personal subject weights, with deadlines breaking ties and default 3',()=>{
 const notices=[
  {id:'a',subject:'수학',dueDate:'2026-11-20',createdAt:'2026-11-01'},
  {id:'b',subject:'국어',dueDate:'2026-11-17',createdAt:'2026-11-01'},
  {id:'c',subject:'수학',dueDate:'2026-11-18',createdAt:'2026-11-01'},
  {id:'d',subject:'영어',dueDate:'2026-11-19',createdAt:'2026-11-01'},
 ];
 assert.deepEqual(model.sortByImportance(notices,{'수학':5,'국어':1}).map(n=>n.id),['c','a','d','b']);
 assert.deepEqual(notices.map(n=>n.id),['a','b','c','d']);
 assert.equal(model.importanceFor('영어',{}),3);
 assert.deepEqual(model.normalizeSubjectImportance({'국어':0,'수학':5,'영어':'4','과학':6}),{'수학':5});
 assert.equal(model.importanceFor('__proto__',{}),3);
});

function fixture() {
 const listeners={},windows={},storage=new Map(); let values={},inputs=[];
 const root={innerHTML:'',querySelector:()=>null,addEventListener:(n,f)=>listeners[n]=f};
 const context=vm.createContext({PlannerModel:model,structuredClone,console,
  localStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v)},
  document:{querySelector:()=>root},window:{addEventListener:(n,f)=>windows[n]=f},
  FormData:class{get(k){return values[k]??null;}getAll(k){return values[k]||[];}}
 });
 vm.runInContext(readFileSync(new URL('./app.js',import.meta.url),'utf8'),context);
 vm.runInContext('showToast=message=>globalThis.lastToast=message;',context);
 return {context,root,storage,windows,
  submit:async(id,v,i=[])=>{values=v;inputs=i;await listeners.submit({preventDefault(){},target:{id,querySelectorAll:()=>inputs}});},
  run:code=>vm.runInContext(code,context)};
}

test('manual refresh reports unchanged, changed and failure; duplicate requests do not run',async()=>{
 const f=fixture();
 f.run('cloudStore={load:async()=>structuredClone(state)};');
 await f.run('refreshCloud(true)');
 assert.match(f.context.lastToast,/이미 최신 상태/);
 f.run('cloudStore={load:async()=>({...structuredClone(state),notices:[]})};');
 await f.run('refreshCloud(true)');
 assert.match(f.context.lastToast,/업데이트 완료/);
 assert.equal(f.run('state.notices.length'),0);
 f.run('cloudStore={load:async()=>{throw new Error("연결 실패")}};');
 await f.run('refreshCloud(true)');
 assert.equal(f.context.lastToast,'연결 실패');
 assert.equal(f.run('refreshing'),false);
 f.run('refreshing=true;');
 await f.run('refreshCloud(true)');
 assert.match(f.context.lastToast,/확인하고 있습니다/);
});

test('personal importance saves, renders colors in feed/planner, survives reload, and separates accounts',async()=>{
 const f=fixture();
 f.windows['planner-login']({detail:{user:{id:'student-a',user_metadata:{}},profile:{role:'student'}}});
 assert.equal(f.run('filter'),'soon');
 assert.equal(f.run('noticeOrder'),'urgency');
 assert.ok(f.run('filteredNotices().every(n=>n.type==="assignment" && daysUntil(n.dueDate)>=0 && daysUntil(n.dueDate)<=3 && !state.completedNoticeIds.includes(n.id))'));
 await f.submit('importance-form',{newSubject:'수학',newLevel:'5'},[{dataset:{importanceSubject:'국어'},value:'1'}]);
 const saved=JSON.parse(f.storage.get(`${model.STORAGE_KEY}:student-a`));
 assert.deepEqual(saved.subjectImportance,{'국어':1,'수학':5});
 assert.match(f.run('renderNoticeRow(state.notices.find(n=>n.subject==="수학"))'),/data-importance="5"/);
 f.run('noticeOrder="importance"; filter="all"');
 assert.equal(f.run('filteredNotices()[0].subject'),'수학');
 f.run('state=restoreState(JSON.parse(localStorage.getItem(accountStorageKey)))');
 assert.equal(f.run('state.subjectImportance["국어"]'),1);
 assert.match(f.run('renderAgenda(state.notices.find(n=>n.subject==="수학").dueDate)'),/data-importance="5"/);
 f.windows['planner-login']({detail:{user:{id:'student-b',user_metadata:{}},profile:{role:'student'}}});
 assert.equal(f.run('PlannerModel.importanceFor("수학",state.subjectImportance)'),3);
});

test('affiliation changes count combined edits once, no-op/name-only cost zero, third edit is disabled, next year resets',async()=>{
 const f=fixture();const year=new Date().getFullYear();
 await f.submit('profile-form',{name:'학생',grade:'1',classroom:'1',clubs:['바이오']});
 assert.equal(f.run('state.profile.schoolChangeCount'),1);
 await f.submit('profile-form',{name:'이름 변경',grade:'1',classroom:'1',clubs:['바이오']});
 assert.equal(f.run('state.profile.schoolChangeCount'),1);
 await f.submit('profile-form',{name:'이름 변경',grade:'3',classroom:'2',clubs:['파이','CC']});
 assert.equal(f.run('state.profile.schoolChangeCount'),2);
 assert.match(f.run('renderProfileDialog()'),/올해 변경 횟수를 모두 사용/);
 await f.submit('profile-form',{name:'이름만 변경',grade:'2',classroom:'3',clubs:['캠']});
 assert.equal(f.run('state.profile.classroom'),2);
 assert.equal(f.run('state.profile.schoolChangeCount'),2);
 assert.equal(f.run('state.profile.name'),'이름만 변경');
 f.run(`state.profile.schoolChangeYear=${year-1}`);
 await f.submit('profile-form',{name:'학생',grade:'2',classroom:'3',clubs:['캠']});
 assert.equal(f.run('state.profile.schoolChangeCount'),1);
 assert.equal(f.run('state.profile.schoolChangeYear'),year);
});

test('v3 cloud profile edits use protected quota RPC and importance updates only caller profile',async()=>{
 const calls=[];
 const c=cloud.createClient({url:'https://example.supabase.co',publishableKey:'test'},
  {user:{id:'caller'},profile:{role:'student'},accessToken:'test'},async(url,options)=>{
   calls.push({url,body:JSON.parse(options.body)});return {ok:true,status:200,json:async()=>[{}]};
  });
 const before={...model.createInitialState(),schemaVersion:3};const after=structuredClone(before);
 after.profile.grade=1;after.profile.clubs=['CC'];after.subjectImportance={'정보':5};
 await c.save(before,after);
 assert.equal(calls.length,2);
 assert.match(calls[0].url,/rpc\/planner_update_school$/);
 assert.deepEqual(calls[0].body.new_clubs,['CC']);
 assert.equal(Object.hasOwn(calls[0].body,'school_change_count'),false);
 assert.match(calls[1].url,/profiles\?id=eq.caller$/);
 assert.deepEqual(calls[1].body,{subject_importance:{'정보':5}});
});

test('server quota rejection is shown rather than reported as saved',async()=>{
 const c=cloud.createClient({url:'https://example.supabase.co',publishableKey:'test'},
  {user:{id:'caller'},profile:{role:'student'},accessToken:'test'},async()=>({ok:false,status:400,json:async()=>({code:'P0001',message:'SCHOOL_CHANGE_LIMIT'})}));
 const before={...model.createInitialState(),schemaVersion:3},after=structuredClone(before);after.profile.grade=1;
 await assert.rejects(c.save(before,after),/이미 2회/);
});

test('v2 deployment keeps personal importance per browser account without attempting unsupported DB writes',async()=>{
 const f=fixture();
 f.run(`cloudStore={save(){throw Error('Unsupported DB write');}};state.schemaVersion=2;accountStorageKey=STORAGE_KEY+':account-a'`);
 await f.submit('importance-form',{newSubject:'수학',newLevel:'5'});
 assert.deepEqual(JSON.parse(f.storage.get(`${model.STORAGE_KEY}:account-a:importance`)),{'수학':5});
 assert.equal(f.run('withPersonalImportance({...state,subjectImportance:{}}).subjectImportance["수학"]'),5);
 f.run(`accountStorageKey=STORAGE_KEY+':account-b'`);
 assert.equal(f.run('PlannerModel.importanceFor("수학",withPersonalImportance({...state,subjectImportance:{}}).subjectImportance)'),3);
});

test('cloud loading v3 restores server year, school quota and importance while retaining v2 compatibility',async()=>{
 for(const version of [2,3]) {
  const c=cloud.createClient({url:'https://example.supabase.co',publishableKey:'test'},
   {user:{id:'caller'},profile:{role:'student'},accessToken:'test'},async(url)=>({ok:true,status:200,json:async()=>
    url.includes('planner_health') ? {schema_version:version,school_year:2027} : url.includes('/profiles?') ?
    [{display_name:'학생',grade:2,classroom:2,clubs:[],school_change_year:2027,school_change_count:2,subject_importance:{'국어':4}}] : []
   }));
  const loaded=await c.load();
  assert.equal(loaded.schoolYear,2027);
  assert.equal(loaded.profile.schoolChangeCount,2);
  assert.deepEqual(loaded.subjectImportance,{'국어':4});
  assert.equal(loaded.schemaVersion,version);
 }
});
