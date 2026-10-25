const PlannerConnection = (() => {
  function validateSettings(url, key) {
    const parsed = new URL(url.trim());
    if (parsed.protocol !== "https:" || !/^[a-z0-9-]+\.supabase\.co$/.test(parsed.hostname)
      || parsed.username || parsed.password || parsed.port || parsed.search || parsed.hash
      || !["", "/"].includes(parsed.pathname)) {
      throw new Error("Connect에 표시된 https://프로젝트주소.supabase.co 형식의 Project URL을 입력하세요.");
    }
    const publishableKey = key.trim();
    if (!/^sb_publishable_[A-Za-z0-9_-]+$/.test(publishableKey)) {
      throw new Error("sb_publishable_로 시작하는 Publishable key를 입력하세요. Secret key는 사용할 수 없습니다.");
    }
    return { url: parsed.origin, publishableKey };
  }

  async function checkConnection(settings, fetcher = fetch) {
    const safe = validateSettings(settings.url, settings.publishableKey);
    const response = await fetcher(`${safe.url}/rest/v1/rpc/planner_health`, {
      method: "POST",
      headers: { apikey: safe.publishableKey, "Content-Type": "application/json" },
      body: "{}",
      signal: AbortSignal.timeout(12000),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) throw new Error("프로젝트 URL과 Publishable key가 같은 프로젝트의 값인지 확인하세요.");
      if (response.status === 404 || body.code === "PGRST202") throw new Error("DB 준비가 필요합니다. Supabase SQL Editor에서 schema.sql을 실행하세요.");
      throw new Error(`서버에서 연결 확인을 완료하지 못했습니다. (HTTP ${response.status})`);
    }
    if (body.schema_version !== 1 || body.table_count !== 6) throw new Error("예상한 학교 플래너 DB 구조와 다릅니다.");
    return { schemaVersion: body.schema_version, tableCount: body.table_count };
  }
  return { validateSettings, checkConnection };
})();
globalThis.PlannerConnection = PlannerConnection;
if (typeof module !== "undefined") module.exports = PlannerConnection;
