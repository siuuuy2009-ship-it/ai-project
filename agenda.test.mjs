import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync } from "node:fs";
import model from "./model.js";

function fixture() {
  const listeners = {};
  const storage = new Map();
  let formValues = {};
  const root = { innerHTML: "", querySelector: () => null, addEventListener: (name, fn) => { listeners[name] = fn; } };
  const context = vm.createContext({
    PlannerModel: model, structuredClone, console,
    localStorage: { getItem: (key) => storage.get(key) || null, setItem: (key, value) => storage.set(key, value) },
    document: { querySelector: () => root }, window: { addEventListener() {} },
    FormData: class { get(name) { return formValues[name]; } },
  });
  vm.runInContext(readFileSync(new URL("./app.js", import.meta.url), "utf8"), context);
  vm.runInContext(`showToast = () => {}; state.personalEvents = [{id:'personal-test', title:'Test event', date:selectedDate, done:false}];
    state.notices = [{id:'notice-test',title:'Test notice',date:selectedDate,dueDate:selectedDate,groupId:'all',subject:'Test',createdAt:new Date().toISOString()}];
    state.savedNoticeIds = ['notice-test']; state.completedNoticeIds = ['notice-test'];`, context);
  return { context, storage,
    submit: async values => { formValues = values; await listeners.submit({ preventDefault() {}, target: { id: "event-form" } }); },
    click: (action, id, kind) => listeners.click({ target: { closest: () => ({ dataset: { action, id, kind } }) } }) };
}

test("both feed and planner expose personal deletion and saved-notice removal", () => {
  const { context } = fixture();
  for (const view of ["renderFeed()", "renderPlanner()"]) {
    const html = vm.runInContext(view, context);
    assert.match(html, /data-action="delete-event"/);
    assert.match(html, /data-action="remove-planner-notice"/);
  }
});

test("assignments automatically appear once, exclude other audiences, and use creation date without deadline", () => {
  const state = model.createInitialState();
  state.savedNoticeIds = [];
  assert.ok(model.plannerEvents(state).some(e => e.id === "sample-2"));
  assert.ok(!model.plannerEvents(state).some(e => e.id === "sample-3"));
  state.notices.push({ id: "no-date", type: "assignment", title: "No date", groupIds: ["all"], dueDate: "", createdAt: "2026-10-31T10:00:00Z" });
  assert.equal(model.plannerEvents(state).find(e => e.id === "no-date").date, "2026-10-31");
  state.savedNoticeIds.push("sample-2");
  assert.equal(model.plannerEvents(state).filter(e => e.id === "sample-2").length, 1);
  state.notices.find(n => n.id === "sample-2").groupIds = ["class-1-1"];
  assert.ok(!model.plannerEvents(state).some(e => e.id === "sample-2"));
});

test("removed automatic assignment stays removed after reload and source edits, and can be restored", () => {
  const { context, storage, click } = fixture();
  vm.runInContext("state.notices[0].type = 'assignment'; state.savedNoticeIds = [];", context);
  click("remove-planner-notice", "notice-test");
  vm.runInContext("state = PlannerModel.restoreState(JSON.parse(localStorage.getItem(STORAGE_KEY))); state.notices[0].title = 'Changed';", context);
  assert.equal(vm.runInContext("calendarEvents().length", context), 1);
  assert.deepEqual(JSON.parse(storage.get(model.STORAGE_KEY)).excludedNoticeIds, ["notice-test"]);
  click("save-planner", "notice-test");
  assert.equal(vm.runInContext("calendarEvents().filter(e => e.id === 'notice-test').length", context), 1);
});

test("planner title and date edits persist independently from original assignment", async () => {
  const { context, storage, click, submit } = fixture();
  vm.runInContext("state.notices[0].type = 'assignment';", context);
  click("edit-event", "notice-test", "notice");
  await submit({ title: "Personal plan", date: "2026-11-15" });
  const saved = model.restoreState(JSON.parse(storage.get(model.STORAGE_KEY)));
  assert.equal(saved.notices[0].title, "Test notice");
  assert.equal(model.plannerEvents(saved).find(e => e.id === "notice-test").title, "Personal plan");
  assert.equal(model.plannerEvents(saved).find(e => e.id === "notice-test").date, "2026-11-15");
  assert.ok(saved.completedNoticeIds.includes("notice-test"));
  click("edit-event", "personal-test", "personal");
  await submit({ title: "Updated event", date: "2026-11-16" });
  const latest = JSON.parse(storage.get(model.STORAGE_KEY));
  assert.equal(latest.personalEvents.length, 1);
  assert.equal(latest.personalEvents[0].title, "Updated event");
});

test("personal deletion persists and survives restoration without removing notices", () => {
  const { context, storage, click } = fixture();
  click("delete-event", "personal-test");
  const saved = model.restoreState(JSON.parse(storage.get(model.STORAGE_KEY)));
  assert.equal(saved.personalEvents.length, 0);
  assert.equal(saved.notices.length, 1);
  assert.equal(vm.runInContext("calendarEvents().some(e => e.id === 'personal-test')", context), false);
});

test("removing a notice from planner keeps source notice and completion, and is idempotent", () => {
  const { storage, click } = fixture();
  click("remove-planner-notice", "notice-test");
  click("remove-planner-notice", "notice-test");
  const saved = model.restoreState(JSON.parse(storage.get(model.STORAGE_KEY)));
  assert.deepEqual(saved.savedNoticeIds, []);
  assert.equal(saved.notices.length, 1);
  assert.deepEqual(saved.completedNoticeIds, ["notice-test"]);
  assert.equal(saved.personalEvents.length, 1);
});
