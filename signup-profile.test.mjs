import test from "node:test";
import assert from "node:assert/strict";
import model from "./model.js";

test("signup profile replaces demo school and clubs without changing original", () => {
  const original = model.createInitialState().profile;
  const next = model.applySignupProfile(original, { grade: 1, classroom: 7, student_number: "0107", clubs: [] });
  assert.equal(next.grade, 1);
  assert.equal(next.classroom, 7);
  assert.equal(next.studentNumber, "0107");
  assert.deepEqual(next.clubs, []);
  assert.equal(original.grade, 2);
});

test("old accounts and malformed metadata retain valid defaults", () => {
  const original = model.createInitialState().profile;
  assert.deepEqual(model.applySignupProfile(original), original);
  assert.deepEqual(model.applySignupProfile(original, { grade: 9, classroom: -1, student_number: '<x>', clubs: 'bad' }), original);
});
