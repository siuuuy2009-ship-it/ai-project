import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync } from "node:fs";
import model from "./model.js";

function fixture() {
  const listeners = {};
  const storage = new Map();
  const root = { innerHTML: "", addEventListener: (name, fn) => { listeners[name] = fn; } };
  const context = vm.createContext({
    PlannerModel: model, structuredClone, console,
    localStorage: { getItem: (key) => storage.get(key) || null, setItem: (key, value) => storage.set(key, value) },
    document: { querySelector: () => root }, window: { addEventListener() {} },
  });
  vm.runInContext(readFileSync(new URL("./app.js", import.meta.url), "utf8"), context);
  vm.runInContext(`showToast = () => {}; state.personalEvents = [{id:'personal-test', title:'Test event', date:selectedDate, done:false}];
    state.notices = [{id:'notice-test',title:'Test notice',date:selectedDate,dueDate:selectedDate,groupId:'all',subject:'Test',createdAt:new Date().toISOString()}];
    state.savedNoticeIds = ['notice-test']; state.completedNoticeIds = ['notice-test'];`, context);
  return { context, storage, click: (action, id) => listeners.click({ target: { closest: () => ({ dataset: { action, id } }) } }) };
}

test("both feed and planner expose personal deletion and saved-notice removal", () => {
  const { context } = fixture();
  for (const view of ["renderFeed()", "renderPlanner()"]) {
    const html = vm.runInContext(view, context);
    assert.match(html, /data-action="delete-event"/);
    assert.match(html, /data-action="remove-planner-notice"/);
  }
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
