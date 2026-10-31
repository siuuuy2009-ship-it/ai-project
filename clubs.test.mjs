import test from "node:test";
import assert from "node:assert/strict";
import model from "./model.js";
import auth from "./auth-api.js";
import vm from "node:vm";
import { readFileSync } from "node:fs";

test("public auth page renders login and signup without local roster scripts", () => {
  const handlers = {};
  const host = { innerHTML: "", addEventListener: (name, fn) => { handlers[name] = fn; } };
  const context = vm.createContext({
    PlannerModel: model, PlannerAuth: { createClient: () => ({}) },
    PLANNER_SUPABASE: {}, lucide: { createIcons() {} },
    document: { getElementById: () => host }, window: { addEventListener() {} },
  });
  vm.runInContext(readFileSync(new URL("./auth-ui.js", import.meta.url), "utf8"), context);
  assert.match(host.innerHTML, /기존 동아리 유지/);
  handlers.click({ target: { closest: selector => selector === "[data-tab]" ? { dataset: { tab: "signup" } } : null } });
  assert.match(host.innerHTML, /name="name"/);
  assert.match(host.innerHTML, /name="studentNumber" type="text"/);
  assert.equal((host.innerHTML.match(/name="clubs"/g) || []).length, 12);
});

test("school club choices contain exactly the supplied twelve names", () => {
  assert.deepEqual([...model.CLUBS], ["파이", "시그마", "메트릭스", "라이프", "바이오", "캠", "별누리", "무한상상", "CC", "첼C", "블리츠", "파인애플"]);
  const html = model.clubCheckboxes(["파이", "CC"]);
  assert.equal((html.match(/type="checkbox"/g) || []).length, 12);
  assert.equal((html.match(/ checked/g) || []).length, 2);
  assert.match(html, /value="CC" checked/);
});

test("multiple selected clubs survive signup serialization", async () => {
  const client = auth.createClient({ url: "https://example.supabase.co", publishableKey: "test" }, async (_, options) => {
    assert.deepEqual(JSON.parse(options.body).data.clubs, ["파이", "첼C", "CC"]);
    return { ok: true, json: async () => ({}) };
  });
  await client.signup({ email: "test@example.com", name: "테스트", role: "student", grade: 2, classroom: 2,
    studentNumber: "2213", password: "test-password", confirmation: "test-password", clubs: "파이,첼C,CC" });
});
