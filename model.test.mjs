import test from "node:test";
import assert from "node:assert/strict";
import model from "./model.js";
const {
  createInitialState, daysUntil, matchesAudience, sortByDeadline, visibleNotices,
} = model;

test("filters notices by class and club membership", () => {
  const state = createInitialState(new Date(2026, 8, 28));
  const ids = visibleNotices(state).map((notice) => notice.id);
  assert.ok(ids.includes("sample-1"));
  assert.ok(ids.includes("sample-4"));
  assert.ok(!ids.includes("sample-5"));
  assert.equal(matchesAudience(state.notices[4], state.profile, state.groups), false);
});

test("sorts dated items first and undated items last", () => {
  const notices = [
    { id: "later", dueDate: "2026-10-10", createdAt: "2026-09-01" },
    { id: "none", dueDate: "", createdAt: "2026-09-02" },
    { id: "soon", dueDate: "2026-09-30", createdAt: "2026-09-01" },
  ];
  assert.deepEqual(sortByDeadline(notices).map((notice) => notice.id), ["soon", "later", "none"]);
});

test("calculates remaining days from the local calendar date", () => {
  const now = new Date(2026, 8, 28, 23, 30);
  assert.equal(daysUntil("2026-09-28", now), 0);
  assert.equal(daysUntil("2026-09-30", now), 2);
  assert.equal(daysUntil("2026-09-27", now), -1);
});
