const PlannerAuth = (() => {
  function createClient(settings, fetcher = fetch) {
    async function request(path, body, token) {
      let response;
      try {
        response = await fetcher(settings.url + path, {
          method: body === undefined ? "GET" : "POST",
          headers: { apikey: settings.publishableKey, "Content-Type": "application/json",
            ...(token ? { Authorization: `Bearer ${token}` } : {}) },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
          signal: AbortSignal.timeout(15000),
        });
      } catch { throw new Error("서버에 연결하지 못했습니다. 인터넷 연결을 확인하고 다시 시도해 주세요."); }
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        const messages = {
          invalid_credentials: "이메일 또는 비밀번호가 올바르지 않습니다.",
          email_not_confirmed: "이메일로 받은 인증 링크를 먼저 눌러 주세요.",
          user_already_exists: "이미 가입한 이메일입니다. 로그인해 주세요.",
          weak_password: "더 안전한 비밀번호를 입력해 주세요.",
          over_email_send_rate_limit: "인증 메일 요청이 많습니다. 잠시 후 다시 시도해 주세요.",
          signup_disabled: "현재 회원가입이 비활성화되어 있습니다. 관리자에게 문의해 주세요.",
        };
        throw new Error(messages[data.code || data.error_code] || (response.status === 429
          ? "요청이 많습니다. 잠시 후 다시 시도해 주세요." : "요청을 완료하지 못했습니다. 입력 내용을 확인하거나 관리자에게 문의해 주세요."));
      }
      return data;
    }
    return {
      async signup({ email, password, confirmation, name, role }) {
        if (!name.trim() || name.trim().length > 40) throw new Error("이름은 1~40자로 입력해 주세요.");
        if (password.length < 8) throw new Error("비밀번호는 8자 이상 입력해 주세요.");
        if (password !== confirmation) throw new Error("비밀번호가 일치하지 않습니다.");
        if (!["student", "teacher"].includes(role)) throw new Error("가입 유형을 선택해 주세요.");
        return request("/auth/v1/signup", { email: email.trim(), password,
          data: { display_name: name.trim(), requested_role: role } });
      },
      async login({ email, password, role }) {
        const session = await request("/auth/v1/token?grant_type=password", { email: email.trim(), password });
        if (!session.access_token || !session.user?.id) throw new Error("로그인 응답을 확인하지 못했습니다.");
        const profiles = await request(`/rest/v1/profiles?id=eq.${encodeURIComponent(session.user.id)}&select=id,role,display_name`, undefined, session.access_token);
        const profile = profiles[0];
        if (!profile || !["teacher", "student"].includes(profile.role)) throw new Error("계정 정보를 찾을 수 없습니다. 관리자에게 문의해 주세요.");
        if (profile.role !== role) throw new Error(role === "teacher"
          ? "교사 승인이 필요합니다. 관리자에게 승인을 요청해 주세요."
          : "교사 계정입니다. 교사를 선택하고 로그인해 주세요.");
        return { user: session.user, profile, accessToken: session.access_token };
      },
      logout: (token) => request("/auth/v1/logout", {}, token),
    };
  }
  return { createClient };
})();
globalThis.PlannerAuth = PlannerAuth;
if (typeof module !== "undefined") module.exports = PlannerAuth;
