(() => {
  const host = document.getElementById("auth-root");
  const app = document.getElementById("app");
  const client = PlannerAuth.createClient(globalThis.PLANNER_SUPABASE);
  const roster = globalThis.PlannerRoster && globalThis.PLANNER_STUDENT_ROSTER
    ? globalThis.PlannerRoster.create(globalThis.PLANNER_STUDENT_ROSTER) : null;
  let signup = false;
  let token = null;
  function render() {
    host.innerHTML = `<section class="auth-page">
      <a class="auth-brand" href="./index.html"><i data-lucide="book-open-check"></i>학교 플래너</a>
      <div class="auth-tabs" role="group" aria-label="계정 메뉴">
        <button type="button" data-tab="login" aria-pressed="${!signup}">로그인</button>
        <button type="button" data-tab="signup" aria-pressed="${signup}">회원가입</button>
      </div>
      <h1>${signup ? "새 계정 만들기" : "다시 만나 반가워요"}</h1>
      <form id="auth-form">
        <fieldset class="auth-roles"><legend>${signup ? "가입 유형" : "계정 유형"}</legend>
          <label><input type="radio" name="role" value="student" checked> 학생</label>
          <label><input type="radio" name="role" value="teacher"> 교사</label>
        </fieldset>
        <p id="teacher-note" hidden>교사 계정은 관리자 승인 후 이용할 수 있습니다.</p>
        ${signup ? (roster ? '<label class="auth-field" id="teacher-name" hidden>교사 이름<input name="name" autocomplete="name" maxlength="40" required disabled></label>' : '<label class="auth-field">이름<input name="name" autocomplete="name" maxlength="40" required></label>') : ""}
        ${signup ? `<fieldset id="student-fields" class="auth-student-fields"><legend>학생 정보</legend>
          <div class="auth-school-row"><label class="auth-field">학년<select name="grade" required><option value="">선택</option>${[1, 2, 3].map(n => `<option value="${n}">${n}학년</option>`).join("")}</select></label>
          <label class="auth-field">반${roster ? '<select name="classroom" required disabled><option value="">학년을 먼저 선택하세요</option></select>' : '<input name="classroom" type="number" min="1" max="30" step="1" required placeholder="예: 2">'}</label></div>
          ${roster ? '<label class="auth-field">학번 · 이름<select name="studentNumber" required disabled><option value="">반을 먼저 선택하세요</option></select></label>' : '<label class="auth-field">학번<input name="studentNumber" type="text" inputmode="numeric" pattern="[0-9]{1,10}" maxlength="10" required placeholder="예: 2213"></label>'}
          ${PlannerModel.clubCheckboxes()}
        </fieldset>` : ""}
        <label class="auth-field">이메일<input name="email" type="email" autocomplete="username" required placeholder="name@example.com"></label>
        <label class="auth-field" for="auth-password">비밀번호${signup ? " (8자 이상)" : ""}</label>
        <div class="auth-password"><input id="auth-password" name="password" type="password" autocomplete="${signup ? "new-password" : "current-password"}" ${signup ? 'minlength="8"' : ""} required><button type="button" data-reveal="auth-password" aria-label="비밀번호 표시" title="비밀번호 표시"><i data-lucide="eye"></i></button></div>
        ${signup ? '<label class="auth-field" for="auth-confirm">비밀번호 확인</label><div class="auth-password"><input id="auth-confirm" name="confirmation" type="password" autocomplete="new-password" minlength="8" required><button type="button" data-reveal="auth-confirm" aria-label="비밀번호 확인 표시" title="비밀번호 확인 표시"><i data-lucide="eye"></i></button></div>' : ""}
        <p id="auth-message" role="status" aria-live="polite"></p>
        <button class="auth-submit" type="submit">${signup ? "회원가입" : "로그인"}</button>
      </form>
    </section>`;
    lucide.createIcons();
    if (signup && roster && !roster.count) document.getElementById("auth-message").textContent = "학생 명단을 불러오지 못했습니다. 관리자에게 문의해 주세요.";
  }
  host.addEventListener("click", (event) => {
    const tab = event.target.closest("[data-tab]");
    if (tab) { signup = tab.dataset.tab === "signup"; render(); }
    const toggle = event.target.closest("[data-reveal]");
    if (toggle) {
      const input = document.getElementById(toggle.dataset.reveal);
      input.type = input.type === "password" ? "text" : "password";
      const label = input.type === "password" ? "비밀번호 표시" : "비밀번호 숨기기";
      toggle.setAttribute("aria-label", label);
      toggle.title = label;
      toggle.innerHTML = `<i data-lucide="${input.type === "password" ? "eye" : "eye-off"}"></i>`;
      lucide.createIcons();
    }
  });
  function syncRole() {
    const teacher = host.querySelector('[name="role"]:checked').value === "teacher";
    document.getElementById("teacher-note").hidden = !teacher;
    const fields = document.getElementById("student-fields");
    if (fields) { fields.hidden = teacher; fields.disabled = teacher; }
    const teacherName = document.getElementById("teacher-name");
    if (teacherName) { teacherName.hidden = !teacher; teacherName.querySelector("input").disabled = !teacher; }
    const grade = host.querySelector('[name="grade"]');
    const classroom = host.querySelector('[name="classroom"]');
    const student = host.querySelector('[name="studentNumber"]');
    if (roster && classroom) classroom.disabled = !grade.value;
    if (roster && student) student.disabled = !classroom.value;
  }
  function setOptions(select, placeholder, entries) {
    select.replaceChildren(new Option(placeholder, ""), ...entries.map(([value, label]) => new Option(label, value)));
  }
  host.addEventListener("change", (event) => {
    if (roster && event.target.name === "grade") {
      setOptions(host.querySelector('[name="classroom"]'), "반 선택", roster.classes(event.target.value).map(n => [String(n), `${n}반`]));
      setOptions(host.querySelector('[name="studentNumber"]'), "반을 먼저 선택하세요", []);
    }
    if (roster && event.target.name === "classroom") {
      const grade = host.querySelector('[name="grade"]').value;
      setOptions(host.querySelector('[name="studentNumber"]'), "본인 선택", roster.list(grade, event.target.value).map(s => [s.studentNumber, `${s.studentNumber} ${s.name}`]));
    }
    syncRole();
  });
  host.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.target;
    const formData = new FormData(form);
    const values = Object.fromEntries(formData);
    if (signup) values.clubs = formData.getAll("clubs").join(",");
    const message = document.getElementById("auth-message");
    const controls = host.querySelectorAll("button, input, select");
    controls.forEach((control) => { control.disabled = true; });
    message.textContent = "처리 중입니다.";
    try {
      if (signup) {
        await client.signup(values.role === "student" && roster ? roster.resolve(values) : values);
        message.textContent = "가입 요청을 처리했습니다. 인증 메일이 도착하면 링크를 누른 뒤 로그인해 주세요. 이미 가입한 이메일이라면 로그인해 주세요." + (values.role === "teacher" ? " 교사 권한은 관리자 승인이 필요합니다." : "");
        form.querySelectorAll('input[type="password"], [name="password"], [name="confirmation"]').forEach((input) => { input.value = ""; });
      } else {
        const session = await client.login(values);
        token = session.accessToken;
        window.dispatchEvent(new CustomEvent("planner-login", { detail: { user: session.user, profile: session.profile } }));
        host.hidden = true;
        app.hidden = false;
        form.reset();
        window.scrollTo(0, 0);
      }
    } catch (error) { message.textContent = error.message; }
    finally { controls.forEach((control) => { control.disabled = false; }); syncRole(); }
  });
  window.addEventListener("planner-logout", async () => {
    const previousToken = token;
    token = null;
    app.hidden = true;
    app.replaceChildren();
    host.hidden = false;
    signup = false;
    render();
    try { if (previousToken) await client.logout(previousToken); }
    catch { document.getElementById("auth-message").textContent = "이 화면에서는 로그아웃했습니다. 서버 로그아웃은 연결 문제로 완료하지 못했습니다."; }
  });
  render();
})();
