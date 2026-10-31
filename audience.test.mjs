import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync } from "node:fs";
import model from "./model.js";

test("school groups cover eighteen classes and twelve clubs and migrate old state once", () => {
  const groups = model.schoolGroups();
  assert.equal(groups.filter(g => g.kind === "class").length, 18);
  assert.deepEqual(groups.filter(g => g.kind === "club").map(g => g.clubName), [...model.CLUBS]);
  const old = { ...model.createInitialState(), groups: [{ id: "custom", kind: "club", clubName: "파이", name: "파이" }] };
  const restored = model.restoreState(old);
  assert.equal(restored.groups.length, 30);
  assert.equal(restored.groups.filter(g => g.clubName === "파이").length, 1);
  assert.equal(restored.groups.find(g => g.clubName === "파이").id, "custom");
  assert.deepEqual(model.restoreState(restored), restored);
});

test("multiple audiences match any selected class or club and keep legacy behavior", () => {
  const groups = model.schoolGroups();
  const notice = { groupIds: ["class-1-1", "school-club-1", "class-3-6"] };
  for (const profile of [{ grade: 1, classroom: 1, clubs: [] }, { grade: 2, classroom: 2, clubs: ["파이"] }, { grade: 3, classroom: 6, clubs: [] }]) {
    assert.equal(model.matchesAudience(notice, profile, groups), true);
  }
  const other = { grade: 2, classroom: 2, clubs: ["시그마"] };
  assert.equal(model.matchesAudience(notice, other, groups), false);
  assert.equal(model.matchesAudience({ groupIds: [] }, other, groups), false);
  assert.equal(model.matchesAudience({ groupId: "all" }, other, groups), true);
  assert.equal(model.matchesAudience({ groupId: "class-2-2" }, other, groups), true);
});

test("notice form saves and edits multiple audiences, rejects empty selection, and switches to all", async () => {
  const handlers = {};
  const storage = new Map();
  const root = { innerHTML: "", addEventListener: (name, fn) => { handlers[name] = fn; } };
  let values = { title: "test", body: "test", subject: "test", type: "notice", audienceScope: "groups", groupIds: ["class-2-2", "school-club-1"], dueDate: "" };
  const context = vm.createContext({
    PlannerModel: model, structuredClone,
    localStorage: { getItem: () => null, setItem: (key, value) => storage.set(key, value) },
    document: { querySelector: () => root }, window: { addEventListener() {} },
    FormData: class { get(name) { return values[name] ?? null; } getAll(name) { return values[name] || []; } },
  });
  vm.runInContext(readFileSync(new URL("./app.js", import.meta.url), "utf8"), context);
  vm.runInContext("showToast = () => {};", context);
  const submit = () => handlers.submit({ preventDefault() {}, target: { id: "notice-form" } });
  await submit();
  let saved = JSON.parse(storage.get(model.STORAGE_KEY));
  assert.deepEqual(saved.notices[0].groupIds, values.groupIds);
  vm.runInContext("editingNoticeId = state.notices[0].id;", context);
  const html = vm.runInContext("renderAudiencePicker(state.notices[0])", context);
  assert.match(html, /value="class-2-2" checked/);
  assert.match(html, /value="school-club-1" checked/);
  assert.match(vm.runInContext("renderTeacher()", context), /2학년 2반, 파이/);
  values = { ...values, groupIds: [] };
  await submit();
  assert.deepEqual(JSON.parse(storage.get(model.STORAGE_KEY)), saved);
  values = { ...values, audienceScope: "all" };
  await submit();
  saved = JSON.parse(storage.get(model.STORAGE_KEY));
  assert.deepEqual(saved.notices[0].groupIds, ["all"]);
  assert.equal(saved.notices.length, model.createInitialState().notices.length + 1);
});
