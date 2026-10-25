import test from "node:test";
import assert from "node:assert/strict";
import connection from "./connection.js";

const settings = { url: "https://example.supabase.co", publishableKey: "sb_publishable_test" };
test("only public project settings are accepted", () => {
  assert.deepEqual(connection.validateSettings(settings.url + "/", settings.publishableKey), settings);
  for (const key of ["sb_secret_test", "service_role", "eyJtoken"]) {
    assert.throws(() => connection.validateSettings(settings.url, key));
  }
  for (const url of ["http://example.supabase.co", "https://example.com", "https://example.supabase.co/path", "https://user@example.supabase.co"]) {
    assert.throws(() => connection.validateSettings(url, settings.publishableKey));
  }
});
test("health check sends public key without JWT Authorization", async () => {
  const result = await connection.checkConnection(settings, async (url, options) => {
    assert.equal(url, settings.url + "/rest/v1/rpc/planner_health");
    assert.equal(options.headers.apikey, settings.publishableKey);
    assert.equal(options.headers.Authorization, undefined);
    assert.equal(options.method, "POST");
    return { ok: true, json: async () => ({ schema_version: 1, table_count: 6 }) };
  });
  assert.deepEqual(result, { schemaVersion: 1, tableCount: 6 });
});
test("missing schema and invalid credentials are not reported as success", async () => {
  for (const status of [404, 401, 403, 500]) {
    await assert.rejects(connection.checkConnection(settings, async () => ({
      ok: false, status, json: async () => ({}),
    })));
  }
  await assert.rejects(connection.checkConnection(settings, async () => ({
    ok: true, json: async () => ({ schema_version: 2, table_count: 6 }),
  })));
});
