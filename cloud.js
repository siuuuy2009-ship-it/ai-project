const PlannerCloud = (() => {
  function createClient(settings, session, fetcher = fetch) {
    let current = { ...session };
    let refreshPromise;
    async function request(path, { method = "GET", body, headers = {} } = {}, retry = true) {
      let response;
      try {
        response = await fetcher(settings.url + path, {
          method, headers: { apikey: settings.publishableKey, Authorization: `Bearer ${current.accessToken}`,
            "Content-Type": "application/json", ...headers },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(20000),
        });
      } catch { throw new Error("서버 연결을 확인하세요. 변경 사항을 저장하지 못했습니다."); }
      if (response.status === 401 && retry && current.refreshToken) {
        if (!refreshPromise) refreshPromise = refresh().finally(() => { refreshPromise = null; });
        await refreshPromise;
        return request(path, { method, body, headers }, false);
      }
      const data = response.status === 204 ? null : await response.json().catch(() => null);
      if (!response.ok) {
        if (response.status === 401) throw new Error("로그인이 만료되었습니다. 다시 로그인해 주세요.");
        if (data?.code === "42703" || data?.code === "PGRST204") throw new Error("DB 업데이트가 필요합니다. upgrade-v2.sql을 실행해 주세요.");
        if (response.status === 403) throw new Error("저장 권한이 없습니다. 계정 역할과 공지 작성자를 확인하세요.");
        throw new Error(`DB 요청에 실패했습니다 (${data?.code || response.status}). 다시 시도해 주세요.`);
      }
      return data;
    }
    async function refresh() {
      const data = await request("/auth/v1/token?grant_type=refresh_token", {
        method: "POST", body: { refresh_token: current.refreshToken },
      }, false);
      if (!data?.access_token) throw new Error("다시 로그인해 주세요.");
      current.accessToken = data.access_token;
      current.refreshToken = data.refresh_token;
    }
    async function rows(table, filter = "") {
      const result = [];
      for (let offset = 0; ; offset += 500) {
        const page = await request(`/rest/v1/${table}?select=*&order=id&limit=500&offset=${offset}${filter}`);
        result.push(...page);
        if (page.length < 500) return result;
      }
    }
    // Composite-key tables do not have an id column.
    async function progressRows() {
      const result = [];
      for (let offset = 0; ; offset += 500) {
        const page = await request(`/rest/v1/notice_progress?select=*&student_id=eq.${current.user.id}&order=notice_id&limit=500&offset=${offset}`);
        result.push(...page);
        if (page.length < 500) return result;
      }
    }
    async function load() {
      const health = await request("/rest/v1/rpc/planner_health", { method: "POST", body: {} });
      if (health?.schema_version !== 2) throw new Error("DB 업데이트가 필요합니다. Supabase에서 upgrade-v2.sql을 실행해 주세요.");
      const [profiles, groups, notices, progress, events] = await Promise.all([
        request(`/rest/v1/profiles?id=eq.${current.user.id}&select=*`), rows("groups"),
        rows("notices", current.profile.role === "teacher" ? `&author_id=eq.${current.user.id}` : ""),
        progressRows(), rows("planner_events", `&student_id=eq.${current.user.id}`),
      ]);
      const p = profiles[0];
      if (!p) throw new Error("학생 정보를 찾을 수 없습니다. 관리자에게 문의해 주세요.");
      return {
        profile: { name: p.display_name, grade: p.grade, classroom: p.classroom, studentNumber: p.student_number || "", clubs: p.clubs || [] },
        groups: [...PlannerModel.schoolGroups(), ...groups.map(g => ({ id: g.id, ownerId: g.owner_id, name: g.name,
          kind: g.kind, grade: g.grade, classroom: g.classroom, clubName: g.club_name }))],
        notices: notices.map(n => ({ id: n.id, authorId: n.author_id, type: n.type, subject: n.subject,
          title: n.title, body: n.body, dueDate: n.due_date || "", groupIds: n.audience_keys, createdAt: n.created_at, attachment: n.attachment })),
        savedNoticeIds: progress.filter(p => p.saved_to_planner).map(p => p.notice_id),
        completedNoticeIds: progress.filter(p => p.completed).map(p => p.notice_id),
        excludedNoticeIds: progress.filter(p => p.excluded_from_planner).map(p => p.notice_id),
        noticePlannerOverrides: progress.filter(p => p.planner_title || p.planner_date).map(p => ({ id: p.notice_id, title: p.planner_title, date: p.planner_date })),
        personalEvents: events.map(e => ({ id: e.id, title: e.title, date: e.event_date, done: e.completed })),
      };
    }
    const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
    async function mutate(table, method, body, filter) {
      const data = await request(`/rest/v1/${table}${filter || ""}`, {
        method, body, headers: { Prefer: "return=representation" },
      });
      if (!data?.length) throw new Error("대상이 삭제되었거나 수정 권한이 없습니다. 새로고침 후 다시 시도해 주세요.");
    }
    async function save(before, after) {
      for (const group of after.groups) {
        if (group.builtIn || before.groups.some(g => g.id === group.id)) continue;
        await mutate("groups", "POST", { id: group.id, owner_id: current.user.id, name: group.name, kind: group.kind,
          grade: group.grade || null, classroom: group.classroom || null, club_name: group.clubName || null });
      }
      for (const notice of before.notices) {
        if (!after.notices.some(n => n.id === notice.id)) await mutate("notices", "DELETE", undefined, `?id=eq.${notice.id}`);
      }
      for (const notice of after.notices) {
        const original = before.notices.find(n => n.id === notice.id);
        if (same(original, notice)) continue;
        const body = { type: notice.type, subject: notice.subject, title: notice.title, body: notice.body,
          due_date: notice.dueDate || null, audience_keys: PlannerModel.audienceIds(notice), attachment: notice.attachment || null, group_id: null };
        await mutate("notices", original ? "PATCH" : "POST", original ? body : { ...body, id: notice.id, author_id: current.user.id }, original ? `?id=eq.${notice.id}` : "");
      }
      for (const group of before.groups) {
        if (!group.builtIn && !after.groups.some(g => g.id === group.id)) await mutate("groups", "DELETE", undefined, `?id=eq.${group.id}`);
      }
      for (const event of before.personalEvents) {
        if (!after.personalEvents.some(e => e.id === event.id)) await mutate("planner_events", "DELETE", undefined, `?id=eq.${event.id}&student_id=eq.${current.user.id}`);
      }
      for (const event of after.personalEvents) {
        const original = before.personalEvents.find(e => e.id === event.id);
        if (!same(original, event)) await mutate("planner_events", original ? "PATCH" : "POST", {
          ...(original ? {} : { id: event.id, student_id: current.user.id }), title: event.title, event_date: event.date, completed: event.done,
        }, original ? `?id=eq.${event.id}&student_id=eq.${current.user.id}` : "");
      }
      function status(state, id) {
        const override = state.noticePlannerOverrides.find(p => p.id === id);
        return { student_id: current.user.id, notice_id: id, completed: state.completedNoticeIds.includes(id),
          saved_to_planner: state.savedNoticeIds.includes(id), excluded_from_planner: state.excludedNoticeIds.includes(id),
          planner_title: override?.title || null, planner_date: override?.date || null };
      }
      for (const notice of after.notices) {
        const next = status(after, notice.id);
        if (same(status(before, notice.id), next)) continue;
        await request("/rest/v1/notice_progress?on_conflict=student_id,notice_id", {
          method: "POST", body: next, headers: { Prefer: "resolution=merge-duplicates" },
        });
      }
      if (before.profile.name !== after.profile.name) await mutate("profiles", "PATCH", { display_name: after.profile.name }, `?id=eq.${current.user.id}`);
      if (!before.profile.grade && !before.profile.classroom && after.profile.grade && after.profile.classroom) {
        await request("/rest/v1/rpc/planner_complete_profile", { method: "POST", body: { new_grade: after.profile.grade, new_classroom: after.profile.classroom } });
      }
    }
    return { load, save, getToken: () => current.accessToken };
  }
  return { createClient };
})();
globalThis.PlannerCloud = PlannerCloud;
if (typeof module !== "undefined") module.exports = PlannerCloud;
