import { PGlite } from '../.scratch/dbtest/node_modules/@electric-sql/pglite/dist/index.js';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import model from '../model.js';
import cloud from '../cloud.js';
const db = new PGlite();
await db.exec(`create role anon; create role authenticated; create schema auth;
create table auth.users(id uuid primary key,raw_user_meta_data jsonb default '{}');
create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
grant usage on schema auth,public to anon,authenticated; grant execute on function auth.uid() to anon,authenticated;`);
await db.exec(readFileSync(new URL('../supabase/schema.sql',import.meta.url),'utf8'));
await db.exec(readFileSync(new URL('../supabase/upgrade-v2.sql',import.meta.url),'utf8'));
// Migration is repeatable and preserves existing profiles.
await db.exec(readFileSync(new URL('../supabase/upgrade-v2.sql',import.meta.url),'utf8'));
const teacher='10000000-0000-4000-8000-000000000001';
const oldUser='70000000-0000-4000-8000-000000000007';
await db.query('insert into auth.users(id) values($1)',[oldUser]);
await db.exec('begin;set local role authenticated;');
await db.query("select set_config('request.jwt.claim.sub',$1,true)",[oldUser]);
await db.query('select public.planner_complete_profile(2,2)');
await db.exec('commit');
assert.equal((await db.query('select grade from public.profiles where id=$1',[oldUser])).rows[0].grade,2);
await db.exec('begin;set local role authenticated;');
await db.query("select set_config('request.jwt.claim.sub',$1,true)",[oldUser]);
await assert.rejects(db.query('select public.planner_complete_profile(1,1)'));
await db.exec('rollback');
const student='20000000-0000-4000-8000-000000000002';
const other='30000000-0000-4000-8000-000000000003';
for(const [id,metadata] of [[teacher,{display_name:'Test Teacher'}],[student,{display_name:'Test Student',grade:2,classroom:2,clubs:['파이']}],[other,{display_name:'Other Student',grade:1,classroom:1,clubs:[],role:'teacher'}]]) {
 await db.query('insert into auth.users values($1,$2)',[id,metadata]);
}
await db.query("update public.profiles set role='teacher' where id=$1",[teacher]);
globalThis.PlannerModel=model;
let pending=Promise.resolve();
const http = (address,options={}) => {
 const task=pending.then(async()=>{
  const url=new URL(address);const user=options.headers?.Authorization?.replace('Bearer ','');
  const token=[teacher,student,other].includes(user)?user:null;
  await db.exec('begin');
  try{
   await db.exec(`set local role ${token?'authenticated':'anon'}`);
   await db.query("select set_config('request.jwt.claim.sub',$1,true)",[token||'']);
   let rows;
   if(url.pathname.endsWith('/rpc/planner_health')) rows=(await db.query('select public.planner_health() as data')).rows[0].data;
   else{
    const table=url.pathname.split('/').pop();
    assert.ok(['profiles','groups','notices','notice_progress','planner_events'].includes(table));
    const args=[];const q=value=>{args.push(value);return '$'+args.length;};
    const where=[];
    for(const [key,value] of url.searchParams)if(value.startsWith('eq.')){assert.match(key,/^[a-z_]+$/);where.push(`"${key}"=${q(value.slice(3))}`);}
    const suffix=where.length?' where '+where.join(' and '):'';
    const method=options.method||'GET';let sql;
    if(method==='GET'){
     sql=`select * from public."${table}"${suffix}`;
     const order=url.searchParams.get('order');if(order){assert.match(order,/^[a-z_]+$/);sql+=` order by "${order}"`;}
     if(url.searchParams.has('limit'))sql+=` limit ${Number(url.searchParams.get('limit'))}`;
     if(url.searchParams.has('offset'))sql+=` offset ${Number(url.searchParams.get('offset'))}`;
    }else if(method==='DELETE')sql=`delete from public."${table}"${suffix} returning *`;
    else{
     const body=JSON.parse(options.body);const keys=Object.keys(body);keys.forEach(k=>assert.match(k,/^[a-z_]+$/));
     if(method==='PATCH')sql=`update public."${table}" set ${keys.map(k=>`"${k}"=${q(body[k])}`).join(',')}${suffix} returning *`;
     else{
      sql=`insert into public."${table}" (${keys.map(k=>'"'+k+'"').join(',')}) values (${keys.map(k=>q(body[k])).join(',')})`;
      if(url.searchParams.get('on_conflict'))sql+=` on conflict(student_id,notice_id) do update set ${keys.filter(k=>!['student_id','notice_id'].includes(k)).map(k=>`"${k}"=excluded."${k}"`).join(',')}`;
      sql+=' returning *';
     }
    }
    rows=(await db.query(sql,args)).rows;
   }
   await db.exec('commit');return {ok:true,status:200,json:async()=>rows};
  }catch(e){console.log('SQL diagnostic:',e.code,e.message);await db.exec('rollback');return {ok:false,status:['42501'].includes(e.code)?403:400,json:async()=>({code:e.code,message:e.message})};}
 });pending=task.catch(()=>{});return task;
};
const settings={url:'https://test.supabase.co',publishableKey:'test'};
const account=(id,role)=>cloud.createClient(settings,{accessToken:id,user:{id},profile:{role}},http);
const t=account(teacher,'teacher'),s=account(student,'student'),o=account(other,'student');
const before=await t.load();assert.equal(before.notices.length,0);
const added=structuredClone(before);
const noticeId='40000000-0000-4000-8000-000000000004';
added.notices.push({id:noticeId,type:'assignment',subject:'정보',title:'공유 과제',body:'DB 저장 검증',dueDate:'2026-11-03',groupIds:['class-2-2','school-club-1'],createdAt:new Date().toISOString(),attachment:null});
await t.save(before,added);
const visible=await s.load();assert.equal(visible.notices[0].title,'공유 과제');assert.equal(model.plannerEvents(visible).length,1);
assert.equal((await o.load()).notices.length,0);
const edited=structuredClone(visible);edited.completedNoticeIds.push(noticeId);edited.noticePlannerOverrides.push({id:noticeId,title:'내 계획',date:'2026-11-02'});
await s.save(visible,edited);
let reloaded=await account(student,'student').load();assert.equal(reloaded.noticePlannerOverrides[0].title,'내 계획');assert.equal(reloaded.completedNoticeIds.length,1);
assert.equal((await t.load()).notices[0].title,'공유 과제');
const hidden=structuredClone(reloaded);hidden.excludedNoticeIds.push(noticeId);await s.save(reloaded,hidden);
assert.equal(model.plannerEvents(await s.load()).length,0);
const eventState=await s.load();const eventNext=structuredClone(eventState);
eventNext.personalEvents.push({id:'50000000-0000-4000-8000-000000000005',title:'개인 일정',date:'2026-11-04',done:false});await s.save(eventState,eventNext);
assert.equal((await s.load()).personalEvents.length,1);assert.equal((await o.load()).personalEvents.length,0);
const change=await t.load();const changed=structuredClone(change);changed.notices[0].title='수정된 원본';await t.save(change,changed);
reloaded=await s.load();assert.equal(reloaded.notices[0].title,'수정된 원본');assert.equal(model.plannerEvents(reloaded).length,1); // personal event only
const restored=structuredClone(reloaded);restored.excludedNoticeIds=[];await s.save(reloaded,restored);assert.equal(model.plannerEvents(await s.load()).length,2);
const denied=await http(settings.url+'/rest/v1/notices',{method:'POST',headers:{Authorization:'Bearer '+student},body:JSON.stringify({id:'60000000-0000-4000-8000-000000000006',author_id:student,type:'notice',subject:'test',title:'forbidden',body:'test',audience_keys:['all']})});assert.equal(denied.status,403);
const roleDenied=await http(settings.url+'/rest/v1/profiles?id=eq.'+other,{method:'PATCH',headers:{Authorization:'Bearer '+other},body:JSON.stringify({role:'teacher'})});assert.equal(roleDenied.status,403);
const clubDenied=await http(settings.url+'/rest/v1/profiles?id=eq.'+other,{method:'PATCH',headers:{Authorization:'Bearer '+other},body:JSON.stringify({clubs:['파이']})});assert.equal(clubDenied.status,403);
const otherProgress=await http(settings.url+'/rest/v1/notice_progress',{method:'POST',headers:{Authorization:'Bearer '+other},body:JSON.stringify({student_id:student,notice_id:noticeId,completed:true})});assert.equal(otherProgress.status,403);
const originalMetadata=await db.query('select clubs from public.profiles where id=$1',[other]);
await db.query("update auth.users set raw_user_meta_data=raw_user_meta_data || '{\"clubs\":[\"파이\"],\"role\":\"teacher\"}'::jsonb where id=$1",[other]);
assert.deepEqual((await db.query('select clubs from public.profiles where id=$1',[other])).rows,originalMetadata.rows);
assert.equal((await o.load()).notices.length,0);
const originalTeacher=await t.load();
const withAttachment=structuredClone(originalTeacher);withAttachment.notices[0].attachment={name:'test.pdf',dataUrl:'data:application/pdf;base64,JVBERg=='};
await t.save(originalTeacher,withAttachment);assert.equal((await s.load()).notices[0].attachment.name,'test.pdf');
const anon=await http(settings.url+'/rest/v1/notices');assert.equal(anon.status,403);
const end=await t.load();const deleted=structuredClone(end);deleted.notices=[];await t.save(end,deleted);assert.equal((await s.load()).notices.length,0);
assert.equal((await db.query('select count(*)::int n from public.notice_progress')).rows[0].n,0);
console.log('PASS: real PostgreSQL migration twice, teacher -> matching student sharing, other audience isolation, automatic planner, durable edits/completion/removal/restore/personal events, source edit/delete cascade, student role/club/notice escalation denied, anonymous denied');
await db.close();
