import test from "node:test";
import assert from "node:assert/strict";
import model from "./model.js";
import cloud from "./cloud.js";
globalThis.PlannerModel = model;
const settings = { url: "https://example.supabase.co", publishableKey: "sb_publishable_test" };
const session = { accessToken: "original", refreshToken: "refresh", user: { id: "user" }, profile: { role: "student" } };
const response = (data, status=200) => ({ ok: status < 400, status, json: async () => data });
const blank = () => ({ ...model.createInitialState(), notices: [], savedNoticeIds: [], personalEvents: [] });

test("failed DB writes and invisible rows cannot be reported as saved", async () => {
  const before=blank(), after=structuredClone(before);
  after.personalEvents.push({id:"event",title:"test",date:"2026-11-02",done:false});
  for(const result of [response({code:"42501"},403),response([])]) {
    const client=cloud.createClient(settings,session,async()=>result);
    await assert.rejects(client.save(before,after));
  }
});

test("expired token refreshes once and retries original write", async () => {
  const calls=[];
  const client=cloud.createClient(settings,session,async(url,options)=>{
    calls.push([url,options]);
    if(url.includes("grant_type=refresh_token")) return response({access_token:"renewed",refresh_token:"new-refresh"});
    return options.headers.Authorization==="Bearer renewed" ? response([{}]) : response({},401);
  });
  const before=blank(),after=structuredClone(before);after.profile.name="Changed";
  await client.save(before,after);
  assert.equal(calls.length,3);
  assert.equal(client.getToken(),"renewed");
  assert.equal(JSON.parse(calls[1][1].body).refresh_token,"refresh");
});

test("save transmits changed rows only, without uploading local sample notices", async()=>{
  const calls=[];
  const client=cloud.createClient(settings,session,async(url,options)=>{calls.push([url,JSON.parse(options.body)]);return response([{}]);});
  const before=model.createInitialState(),after=structuredClone(before);
  after.completedNoticeIds.push("sample-1");
  await client.save(before,after);
  assert.equal(calls.length,1);
  assert.match(calls[0][0],/notice_progress/);
  assert.equal(calls[0][1].completed,true);
  assert.equal(calls[0][1].student_id,"user");
});

test("schema v1 blocks cloud login with actionable migration message",async()=>{
  const client=cloud.createClient(settings,session,async()=>response({schema_version:1}));
  await assert.rejects(client.load(),/upgrade-v2.sql/);
});
