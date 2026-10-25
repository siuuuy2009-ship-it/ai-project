import test from "node:test";
import assert from "node:assert/strict";
import auth from "./auth-api.js";
const config = { url: "https://example.supabase.co", publishableKey: "sb_publishable_test" };
const values = { email: " student@example.com ", password: "test-password-123", confirmation: "test-password-123", name: "학생", role: "student" };
const response = (data, ok = true, status = 200) => ({ ok, status, json: async () => data });

test("signup validates password confirmation before making a request", async () => {
  const client = auth.createClient(config, () => { throw new Error("should not call"); });
  await assert.rejects(client.signup({ ...values, confirmation: "different" }), /일치/);
  await assert.rejects(client.signup({ ...values, password: "short" }), /8자/);
});
test("teacher signup records only a request, not an authorized role", async () => {
  const client = auth.createClient(config, async (url, options) => {
    assert.equal(url, config.url + "/auth/v1/signup");
    const body = JSON.parse(options.body);
    assert.equal(body.email, "student@example.com");
    assert.equal(body.data.requested_role, "teacher");
    assert.equal(body.data.role, undefined);
    assert.equal(body.role, undefined);
    return response({ user: { id: "test" } });
  });
  await client.signup({ ...values, role: "teacher" });
});
test("teacher login requires database role even when metadata claims teacher", async () => {
  const client = auth.createClient(config, async (url) => url.includes("/token")
    ? response({ access_token: "test-token", user: { id: "test", user_metadata: { role: "teacher" } } })
    : response([{ id: "test", role: "student" }]));
  await assert.rejects(client.login({ ...values, role: "teacher" }), /승인/);
});
test("login uses authenticated profile lookup", async () => {
  const client = auth.createClient(config, async (url, options) => {
    if (url.includes("/token")) return response({ access_token: "test-token", user: { id: "test" } });
    assert.equal(options.headers.Authorization, "Bearer test-token");
    return response([{ id: "test", role: "student" }]);
  });
  assert.equal((await client.login(values)).profile.role, "student");
});
test("login reports email confirmation and network errors", async () => {
  const client = auth.createClient(config, async () => response({ code: "email_not_confirmed" }, false, 400));
  await assert.rejects(client.login(values), /인증/);
  const offline = auth.createClient(config, async () => { throw new TypeError("network"); });
  await assert.rejects(offline.login(values), /연결/);
});
