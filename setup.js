const settings = globalThis.PLANNER_SUPABASE || {};
const urlInput = document.getElementById("project-url");
const keyInput = document.getElementById("public-key");
const button = document.getElementById("check-button");
const result = document.getElementById("connection-result");
urlInput.value = settings.url || "";
keyInput.value = settings.publishableKey || "";

document.getElementById("connection-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  button.disabled = true;
  result.textContent = "확인 중입니다.";
  try {
    const health = await PlannerConnection.checkConnection({
      url: urlInput.value, publishableKey: keyInput.value,
    });
    result.textContent = `서버 연결 성공. DB 설정 버전 ${health.schemaVersion}입니다. 실제 계정별 저장 동작은 별도 확인이 필요합니다.`;
  } catch (error) {
    result.textContent = error.name === "TimeoutError"
      ? "응답 시간이 초과되었습니다. 잠시 후 다시 확인하세요."
      : error instanceof TypeError
        ? "주소 형식 또는 인터넷 연결을 확인하세요."
        : error.message;
  } finally {
    button.disabled = false;
  }
});
