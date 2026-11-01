import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import {readFileSync} from "node:fs";
import model from "./model.js";

function fixture(client,storage=new Map()) {
  let now=Date.now();const handlers={};let tick;
  const elements=Object.fromEntries(["auth-form","auth-message","teacher-note","email-next","pending-email","email-message","resend-email"].map(id=>[id,{hidden:false,disabled:false,textContent:""}]));
  const submit={disabled:false,textContent:""};
  elements["auth-form"].querySelectorAll=()=>[];
  const host={innerHTML:"",addEventListener:(name,fn)=>{handlers[name]=fn;},querySelectorAll:()=>[],
    querySelector:selector=>selector===".auth-submit"?submit:selector.includes('name="role"')?{value:"student"}:null};
  class Clock extends Date {static now(){return now;}}
  const values={role:"student",name:"테스트",grade:"2",classroom:"2",studentNumber:"2213",email:"test@example.com",password:"test-password",confirmation:"test-password"};
  const context=vm.createContext({Date:Clock,PlannerModel:model,PlannerAuth:{createClient:()=>client},PLANNER_SUPABASE:{},lucide:{createIcons(){}},
    document:{getElementById:id=>id==="auth-root"?host:elements[id]||null},window:{addEventListener(){}},
    sessionStorage:{getItem:key=>storage.get(key),setItem:(key,value)=>storage.set(key,value)},
    setInterval:fn=>{tick=fn;return 1;},clearInterval(){},
    FormData:class { [Symbol.iterator](){return Object.entries(values)[Symbol.iterator]();}getAll(){return [];}}});
  vm.runInContext(readFileSync(new URL('./auth-ui.js',import.meta.url),'utf8'),context);
  const click=key=>handlers.click({target:{closest:selector=>selector==="[data-tab]"&&key==="signup"?{dataset:{tab:"signup"}}:selector==="#resend-email"&&key==="resend"?{}:null}});
  return {elements,submit,storage,click,submitForm:()=>handlers.submit({preventDefault(){},target:elements['auth-form']}),advance:seconds=>{now+=seconds*1000;tick?.();}};
}

test("signup success enters email confirmation and blocks repeat clicks until cooldown expires",async()=>{
  let finish;let calls=0;let resends=0;
  const f=fixture({signup:()=>{calls++;return new Promise(resolve=>{finish=resolve;});},resend:async()=>{resends++;return {};}});
  await f.click("signup");const pending=f.submitForm();await f.submitForm();assert.equal(calls,1);
  finish({});await pending;
  assert.equal(f.elements['auth-form'].hidden,true);assert.equal(f.elements['email-next'].hidden,false);
  assert.equal(f.elements['resend-email'].disabled,true);
  await f.click("resend");assert.equal(resends,0);
  f.advance(61);await f.click("resend");assert.equal(resends,1);
  assert.match(f.elements['email-message'].textContent,/재발송/);
  assert.ok([...f.storage.values()].every(value=>/^\d+$/.test(value)));
});

test("rate limit locks signup across reloads without resubmitting or persisting credentials",async()=>{
  const f=fixture({signup:async()=>{throw Object.assign(new Error("메일 한도"),{retryAfter:125});}});
  await f.click('signup');await f.submitForm();
  assert.equal(f.submit.disabled,true);assert.match(f.elements['auth-message'].textContent,/메일 한도/);
  let calls=0;const reloaded=fixture({signup:async()=>{calls++;}},f.storage);
  await reloaded.click('signup');await reloaded.submitForm();assert.equal(calls,0);
  assert.match(reloaded.submit.textContent,/후 다시 시도/);
});
