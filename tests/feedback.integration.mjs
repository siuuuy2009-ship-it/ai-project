import {PGlite} from '../.scratch/dbtest/node_modules/@electric-sql/pglite/dist/index.js';
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
const db=new PGlite();
await db.exec(`create role anon;create role authenticated;create schema auth;
 create table auth.users(id uuid primary key,raw_user_meta_data jsonb default '{}');
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 grant usage on schema auth,public to anon,authenticated;grant execute on function auth.uid() to anon,authenticated;`);
for(const file of ['schema.sql','upgrade-v2.sql','upgrade-v3.sql','upgrade-v3.sql']) await db.exec(readFileSync(new URL('../supabase/'+file,import.meta.url),'utf8'));
const a='11111111-1111-4111-8111-111111111111',b='22222222-2222-4222-8222-222222222222';
for(const id of [a,b])await db.query('insert into auth.users values($1,$2)',[id,{grade:2,classroom:2,clubs:['파이'],display_name:'Test'}]);
async function as(id,sql,args=[]){
 await db.exec('begin');
 try{await db.exec(`set local role ${id?'authenticated':'anon'}`);await db.query("select set_config('request.jwt.claim.sub',$1,true)",[id||'']);const result=await db.query(sql,args);await db.exec('commit');return result;}
 catch(e){await db.exec('rollback');throw e;}
}
const rpc=(id,grade,room,clubs,name='Test')=>as(id,'select public.planner_update_school($1,$2,$3,$4) result',[grade,room,clubs,name]);
assert.equal((await rpc(a,2,2,['파이'],'Rename')).rows[0].result.used,0);
assert.equal((await rpc(a,1,3,['바이오','CC'])).rows[0].result.used,1);
assert.equal((await rpc(a,1,3,['CC','바이오'])).rows[0].result.used,1);
assert.equal((await rpc(a,3,6,['시그마'])).rows[0].result.used,2);
await assert.rejects(rpc(a,2,2,['파이']),/SCHOOL_CHANGE_LIMIT/);
assert.equal((await db.query('select grade from public.profiles where id=$1',[a])).rows[0].grade,3);
assert.equal((await rpc(a,3,6,['시그마'],'Name only')).rows[0].result.used,2);
assert.equal((await rpc(b,1,1,['CC'])).rows[0].result.used,1);
const teacher='33333333-3333-4333-8333-333333333333';
await db.query('insert into auth.users values($1,$2)',[teacher,{display_name:'Teacher'}]);
await db.query("update public.profiles set role='teacher' where id=$1",[teacher]);
await db.query("insert into public.notices(author_id,type,subject,title,body,audience_keys) values($1,'assignment','수학','대상 검증','내용',array['class-3-6'])",[teacher]);
assert.equal((await as(a,'select title from public.notices')).rows.length,1);
assert.equal((await as(b,'select title from public.notices')).rows.length,0);
await assert.rejects(as(a,'update public.profiles set school_change_count=0 where id=$1',[a]));
await assert.rejects(as(a,'update public.profiles set grade=1 where id=$1',[a]));
await assert.rejects(rpc(null,1,1,[]));
await assert.rejects(rpc(b,1,1,['비공식 동아리']),/INVALID_SCHOOL_PROFILE/);
await assert.rejects(rpc(b,0,1,[]),/INVALID_SCHOOL_PROFILE/);
await as(a,'update public.profiles set subject_importance=$1 where id=$2',[{'수학':5,'국어':1},a]);
assert.deepEqual((await as(a,'select subject_importance from public.profiles where id=$1',[a])).rows[0].subject_importance,{'수학':5,'국어':1});
assert.equal((await as(b,'select id from public.profiles where id=$1',[a])).rows.length,0);
for(const value of [{'수학':6},{'수학':'5'},['수학']])await assert.rejects(as(a,'update public.profiles set subject_importance=$1 where id=$2',[value,a]));
await db.query("update public.profiles set school_change_year=extract(year from now() at time zone 'Asia/Seoul')::integer-1 where id=$1",[a]);
assert.equal((await rpc(a,2,4,['파이'])).rows[0].result.used,1);
assert.equal((await as(a,'select title from public.notices')).rows.length,0);
assert.equal((await as(a,'select public.planner_health() result')).rows[0].result.schema_version,3);
console.log('PASS: v3 upgrade repeatable, subject importance private/validated, combined school change count, no-op/name free, 3rd rejected atomically, per-account/year reset, anonymous/direct grade/counter modification denied');
await db.close();
