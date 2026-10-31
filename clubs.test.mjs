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
  assert.doesNotMatch(host.innerHTML, /name="loginClub"|name="clubs"/);
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

test("login restores signup clubs and profile editing cannot replace them", async () => {
  const rootHandlers = {};
  const windowHandlers = {};
  const root = { innerHTML: "", addEventListener: (name, fn) => { rootHandlers[name] = fn; } };
  const saved = model.createInitialState();
  saved.profile.clubs = ["블리츠"];
  const storage = new Map([[`${model.STORAGE_KEY}:test-user`, JSON.stringify(saved)]]);
  const context = vm.createContext({
    PlannerModel: model, structuredClone,
    localStorage: { getItem: key => storage.get(key) || null, setItem: (key, value) => storage.set(key, value) },
    document: { querySelector: () => root },
    window: { addEventListener: (name, fn) => { windowHandlers[name] = fn; } },
    FormData: class { get(name) { return ({ name: "학생", grade: "2", classroom: "2", clubs: "시그마" })[name]; } },
  });
  vm.runInContext(readFileSync(new URL("./app.js", import.meta.url), "utf8"), context);
  vm.runInContext("showToast = () => {};", context);
  windowHandlers["planner-login"]({ detail: { user: { id: "test-user", user_metadata: { clubs: ["파이", "CC"] } }, profile: { role: "student" }, loginClub: "시그마" } });
  assert.deepEqual([...vm.runInContext("state.profile.clubs", context)], ["파이", "CC"]);
  assert.doesNotMatch(root.innerHTML, /name="clubs"/);
  assert.match(root.innerHTML, /등록된 동아리/);
  await rootHandlers.submit({ preventDefault() {}, target: { id: "profile-form" } });
  assert.deepEqual(JSON.parse(storage.get(`${model.STORAGE_KEY}:test-user`)).profile.clubs, ["파이", "CC"]);
  windowHandlers["planner-login"]({ detail: { user: { id: "old-user", user_metadata: {} }, profile: { role: "student" } } });
  assert.deepEqual([...vm.runInContext("state.profile.clubs", context)], []);
});

test("multiple selected clubs survive signup serialization", async () => {
  const client = auth.createClient({ url: "https://example.supabase.co", publishableKey: "test" }, async (_, options) => {
    assert.deepEqual(JSON.parse(options.body).data.clubs, ["파이", "첼C", "CC"]);
    return { ok: true, json: async () => ({}) };
  });
  await client.signup({ email: "test@example.com", name: "테스트", role: "student", grade: 2, classroom: 2,
    studentNumber: "2213", password: "test-password", confirmation: "test-password", clubs: "파이,첼C,CC" });
});
