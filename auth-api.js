const PlannerAuth = (() => {
  function createClient(settings, fetcher = fetch) {
    let emailRequestPending = false;
    async function emailRequest(path, body) {
      if (emailRequestPending) throw new Error("이미 요청을 처리 중입니다. 잠시 기다려 주세요.");
      emailRequestPending = true;
      try { return await request(path, body); }
      finally { emailRequestPending = false; }
    }
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
          over_email_send_rate_limit: "인증 메일 발송 한도에 도달했습니다. 기본 발송 서비스를 사용한다면 최대 1시간 기다려야 할 수 있습니다. 계속되면 관리자에게 메일 발송 설정을 요청해 주세요.",
          over_request_rate_limit: "가입 요청이 잠시 제한됐습니다. 표시된 대기 시간 뒤 한 번만 다시 시도해 주세요.",
          email_address_not_authorized: "현재 메일 서버는 이 주소로 인증 메일을 보낼 수 없습니다. 관리자에게 메일 발송 설정을 요청해 주세요.",
          email_address_invalid: "이메일 주소를 다시 확인해 주세요.",
          signup_disabled: "현재 회원가입이 비활성화되어 있습니다. 관리자에게 문의해 주세요.",
        };
        let code = data.code || data.error_code || "";
        const detail = data.msg || data.message || data.error_description || "";
        if (!code && /email.*rate|rate.*email/i.test(detail)) code = "over_email_send_rate_limit";
        if (/email address not authorized/i.test(detail)) code = "email_address_not_authorized";
        const deliveryFailed = /sending.*(email|mail)|smtp/i.test(detail);
        const error = new Error(messages[code] || (response.status === 429
          ? "요청 횟수 제한에 도달했습니다. 대기 시간이 지나도 계속되면 관리자에게 문의해 주세요."
          : deliveryFailed ? "인증 메일 발송에 실패했습니다. 관리자에게 메일 서버 설정을 확인해 달라고 요청해 주세요."
            : "요청을 완료하지 못했습니다. 입력 내용을 확인하거나 관리자에게 문의해 주세요."));
        error.code = code || `http_${response.status}`;
        if (response.status === 429 || code.startsWith("over_")) {
          const raw = response.headers?.get("retry-after");
          const seconds = raw && /^\d+$/.test(raw) ? Number(raw) : raw ? Math.ceil((Date.parse(raw) - Date.now()) / 1000) : NaN;
          error.retryAfter = Number.isFinite(seconds) && seconds > 0 ? Math.min(seconds, 86400)
            : code === "over_email_send_rate_limit" ? 3600 : 60;
        }
        throw error;
      }
      return data;
    }
    return {
      async signup({ email, password, confirmation, name, role, grade, classroom, studentNumber, clubs = "" }) {
        if (!name.trim() || name.trim().length > 40) throw new Error("이름은 1~40자로 입력해 주세요.");
        if (password.length < 8) throw new Error("비밀번호는 8자 이상 입력해 주세요.");
        if (password !== confirmation) throw new Error("비밀번호가 일치하지 않습니다.");
        if (!["student", "teacher"].includes(role)) throw new Error("가입 유형을 선택해 주세요.");
        const student = {};
        if (role === "student") {
          if (![1, 2, 3].includes(Number(grade))) throw new Error("학년을 선택해 주세요.");
          if (!Number.isInteger(Number(classroom)) || Number(classroom) < 1 || Number(classroom) > 30) throw new Error("반은 1~30 사이의 정수로 입력해 주세요.");
          const number = String(studentNumber || "").trim();
          if (!/^[0-9]{1,10}$/.test(number)) throw new Error("학번은 숫자 1~10자리로 입력해 주세요.");
          const list = [...new Set(String(clubs).split(",").map(value => value.trim()).filter(Boolean))];
          if (String(clubs).length > 200 || list.length > 12 || list.some(value => value.length > 30)) throw new Error("동아리는 이름당 30자, 최대 12개까지 입력해 주세요.");
          Object.assign(student, { grade: Number(grade), classroom: Number(classroom), student_number: number, clubs: list });
        }
        return emailRequest("/auth/v1/signup", { email: email.trim(), password,
          data: { display_name: name.trim(), requested_role: role, ...student } });
      },
      resend(email) {
        const normalized = String(email || "").trim();
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) throw new Error("이메일 주소를 확인해 주세요.");
        return emailRequest("/auth/v1/resend", { type: "signup", email: normalized });
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
        return { user: session.user, profile, accessToken: session.access_token, refreshToken: session.refresh_token };
      },
      logout: (token) => request("/auth/v1/logout", {}, token),
    };
  }
  return { createClient };
})();
globalThis.PlannerAuth = PlannerAuth;
if (typeof module !== "undefined") module.exports = PlannerAuth;
