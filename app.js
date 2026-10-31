const {
  STORAGE_KEY, createInitialState, dateKey, daysUntil, matchesAudience,
  restoreState, sortByDeadline, visibleNotices,
} = globalThis.PlannerModel;

const root = document.querySelector("#app");
let state;
let accountStorageKey = STORAGE_KEY;
try {
  state = restoreState(JSON.parse(localStorage.getItem(STORAGE_KEY)));
} catch {
  state = createInitialState();
}

let mode = "student";
let view = "feed";
let filter = "all";
let subjectFilter = "all";
let search = "";
let selectedDate = dateKey();
let calendarMonth = selectedDate.slice(0, 7);
let editingNoticeId = null;
let groupFormOpen = false;
let activeDialog = null;
let toastTimer;

const icon = (name) => `<i data-lucide="${name}" aria-hidden="true"></i>`;
const escapeHtml = (value = "") => String(value).replace(/[&<>"']/g, (char) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
})[char]);
const newId = () => globalThis.crypto?.randomUUID?.() || `id-${Date.now()}-${Math.random().toString(36).slice(2)}`;
const groupLabel = (id) => id === "all" ? "전체 학생" : (state.groups.find((group) => group.id === id)?.name || "삭제된 그룹");

function formatDate(key, options = { month: "short", day: "numeric", weekday: "short" }) {
  if (!key) return "마감일 없음";
  const [year, month, day] = key.split("-").map(Number);
  return new Intl.DateTimeFormat("ko-KR", options).format(new Date(year, month - 1, day));
}

function dueInfo(key) {
  const days = daysUntil(key);
  if (days === null) return { text: "마감일 없음", className: "" };
  if (days < 0) return { text: `${Math.abs(days)}일 지남`, className: "overdue" };
  if (days === 0) return { text: "오늘 마감", className: "today" };
  if (days <= 3) return { text: `D-${days}`, className: "soon" };
  return { text: `D-${days}`, className: "" };
}

function persist(next, successMessage) {
  try {
    localStorage.setItem(accountStorageKey, JSON.stringify(next));
    state = next;
    render();
    if (successMessage) showToast(successMessage);
    return true;
  } catch {
    showToast("브라우저 저장 공간이 부족합니다. 첨부파일 크기를 확인해 주세요.");
    return false;
  }
}

function showToast(message) {
  clearTimeout(toastTimer);
  document.querySelector(".toast")?.remove();
  const toast = document.createElement("div");
  toast.className = "toast";
  toast.setAttribute("role", "status");
  toast.textContent = message;
  document.body.append(toast);
  toastTimer = setTimeout(() => toast.remove(), 3500);
}

function renderSidebar() {
  const items = mode === "student"
    ? [["feed", "layout-list", "공지·과제"], ["planner", "calendar-days", "나의 플래너"]]
    : [["teacher", "clipboard-pen-line", "공지 관리"]];
  return `<aside class="sidebar">
    <div class="brand"><span class="brand-mark">${icon("book-open-check")}</span><span>학교 플래너</span></div>
    <div class="side-caption">WORKSPACE</div>
    <nav class="side-nav" aria-label="주요 메뉴">
      ${items.map(([id, symbol, label]) => `<button type="button" class="side-link ${view === id ? "active" : ""}" data-action="nav" data-view="${id}" aria-label="${label}" title="${label}">${icon(symbol)}<span>${label}</span></button>`).join("")}
    </nav>
    <div class="sidebar-foot">체험 데이터<br>이 브라우저에만 저장됩니다.</div>
  </aside>`;
}

function renderTopbar() {
  const roleName = mode === "student" ? `${state.profile.grade}학년 ${state.profile.classroom}반${state.profile.studentNumber ? ` · ${escapeHtml(state.profile.studentNumber)}` : ""}` : "선생님 화면";
  return `<header class="topbar">
    <div class="topbar-left"><span>학교 플래너</span><span class="term">/ ${roleName}</span></div>
    <div class="topbar-right">
      <span>${mode === "student" ? "학생" : "교사"}</span>
      <button type="button" class="icon-button" data-action="logout" aria-label="로그아웃" title="로그아웃">${icon("log-out")}</button>
      <button type="button" class="icon-button" data-action="profile" aria-label="학생 정보 설정" title="학생 정보 설정">${icon("settings-2")}</button>
      <span class="avatar" aria-hidden="true">${mode === "student" ? "학" : "선"}</span>
      <span class="profile-name">${mode === "student" ? escapeHtml(state.profile.name) : "선생님"}</span>
    </div>
  </header>`;
}

function filteredNotices() {
  return visibleNotices(state).filter((notice) => {
    if (filter === "notice" && notice.type !== "notice") return false;
    if (filter === "assignment" && notice.type !== "assignment") return false;
    if (filter === "soon" && (notice.type !== "assignment" || daysUntil(notice.dueDate) > 3 || daysUntil(notice.dueDate) < 0 || !notice.dueDate)) return false;
    if (subjectFilter !== "all" && notice.subject !== subjectFilter) return false;
    return !search || `${notice.title} ${notice.body} ${notice.subject}`.toLowerCase().includes(search.toLowerCase());
  });
}

function renderNoticeRow(notice) {
  const due = dueInfo(notice.dueDate);
  const completed = state.completedNoticeIds.includes(notice.id);
  const saved = state.savedNoticeIds.includes(notice.id);
  return `<article class="notice-row ${completed ? "completed" : ""}">
    <input class="check" type="checkbox" data-complete-notice="${escapeHtml(notice.id)}" aria-label="${escapeHtml(notice.title)} 완료" ${completed ? "checked" : ""}>
    <div class="notice-main">
      <button type="button" class="notice-title" data-action="detail" data-id="${escapeHtml(notice.id)}">${escapeHtml(notice.title)}</button>
      <p class="notice-body-preview">${escapeHtml(notice.body)}</p>
      <div class="notice-meta"><span class="type-tag ${notice.type}">${notice.type === "assignment" ? "과제" : "공지"}</span><span class="subject-tag">${escapeHtml(notice.subject)}</span><span>${escapeHtml(groupLabel(notice.groupId))}</span></div>
    </div>
    <div class="notice-actions">
      <span class="deadline ${due.className}">${icon("clock-3")}${due.text}</span>
      <button type="button" class="icon-button ${saved ? "active" : ""}" data-action="save-planner" data-id="${escapeHtml(notice.id)}" aria-label="${saved ? "플래너에서 제거" : "플래너에 추가"}" title="${saved ? "플래너에서 제거" : "플래너에 추가"}" ${!notice.dueDate ? "disabled" : ""}>${icon(saved ? "calendar-check-2" : "calendar-plus-2")}</button>
    </div>
  </article>`;
}

function calendarEvents() {
  const saved = state.notices.filter((notice) => state.savedNoticeIds.includes(notice.id) && notice.dueDate && matchesAudience(notice, state.profile, state.groups));
  return [
    ...saved.map((notice) => ({ id: notice.id, title: notice.title, date: notice.dueDate, kind: "notice", subject: notice.subject, done: state.completedNoticeIds.includes(notice.id) })),
    ...state.personalEvents.map((event) => ({ ...event, kind: "personal" })),
  ];
}

function renderCalendar(large = false) {
  const [year, month] = calendarMonth.split("-").map(Number);
  const first = new Date(year, month - 1, 1);
  const offset = (first.getDay() + 6) % 7;
  const eventDates = new Set(calendarEvents().map((event) => event.date));
  const weekdays = ["월", "화", "수", "목", "금", "토", "일"];
  return `<div class="${large ? "planner-calendar" : ""}">
    <div class="calendar-bar"><strong>${year}년 ${month}월</strong><div class="calendar-controls">
      <button type="button" class="icon-button" data-action="month" data-direction="-1" aria-label="이전 달" title="이전 달">${icon("chevron-left")}</button>
      <button type="button" class="icon-button" data-action="month" data-direction="1" aria-label="다음 달" title="다음 달">${icon("chevron-right")}</button>
    </div></div>
    <div class="calendar-weekdays">${weekdays.map((day) => `<span>${day}</span>`).join("")}</div>
    <div class="calendar-grid">${Array.from({ length: 42 }, (_, index) => {
      const date = new Date(year, month - 1, index + 1 - offset);
      const key = dateKey(date);
      const classes = ["calendar-day", key.slice(0, 7) !== calendarMonth ? "other-month" : "", key === selectedDate ? "selected" : "", key === dateKey() ? "today" : ""].filter(Boolean).join(" ");
      return `<button type="button" class="${classes}" data-action="date" data-date="${key}" aria-label="${formatDate(key, { year: "numeric", month: "long", day: "numeric" })}" aria-pressed="${key === selectedDate}"><span>${date.getDate()}</span>${eventDates.has(key) ? '<span class="dot"></span>' : ""}</button>`;
    }).join("")}</div>
  </div>`;
}

function renderAgenda(date) {
  const events = calendarEvents().filter((event) => event.date === date);
  if (!events.length) return `<div class="empty-state" style="min-height:135px"><span>${icon("calendar-x-2")}</span><strong>일정이 없습니다</strong><p>선택한 날짜에 등록된 일정이 없습니다.</p></div>`;
  return `<div class="agenda-list">${events.map((event) => `<div class="agenda-item">
    <span class="agenda-accent ${event.kind === "personal" ? "personal" : ""}"></span>
    <div style="min-width:0;flex:1"><div class="agenda-title" style="${event.done ? "text-decoration:line-through;color:#8a9898" : ""}">${escapeHtml(event.title)}</div><div class="agenda-meta">${event.kind === "personal" ? "개인 일정" : escapeHtml(event.subject)}</div></div>
    <input class="check" type="checkbox" data-${event.kind === "personal" ? "complete-event" : "complete-notice"}="${escapeHtml(event.id)}" aria-label="${escapeHtml(event.title)} 완료" ${event.done ? "checked" : ""}>
    <button type="button" class="icon-button" data-action="${event.kind === "personal" ? "delete-event" : "remove-planner-notice"}" data-id="${escapeHtml(event.id)}" aria-label="${escapeHtml(event.title)} ${event.kind === "personal" ? "일정 삭제" : "플래너에서 제거"}" title="${event.kind === "personal" ? "일정 삭제" : "플래너에서 제거 (원본 공지 유지)"}">${icon("trash-2")}</button>
  </div>`).join("")}</div>`;
}

function renderFeed() {
  const notices = filteredNotices();
  const subjects = [...new Set(visibleNotices(state).map((notice) => notice.subject))].sort((a, b) => a.localeCompare(b, "ko"));
  const tabs = [["all", "전체"], ["notice", "공지"], ["assignment", "과제"], ["soon", "마감 임박"]];
  return `<div class="page-heading"><div><p class="eyebrow">STUDENT DASHBOARD</p><h1>공지와 과제</h1><p class="subheading">${state.profile.grade}학년 ${state.profile.classroom}반${state.profile.clubs.length ? ` · ${escapeHtml(state.profile.clubs.join(", "))}` : ""}</p></div><span class="badge">예시 데이터 포함</span></div>
    <div class="dashboard-grid">
      <section class="pane" aria-label="공지 및 과제 목록">
        <div class="section-heading"><h2>내게 온 소식</h2><div class="count-line"><strong>${notices.length}</strong>건</div></div>
        <div class="filter-row"><div class="tabs" role="group" aria-label="공지 필터">${tabs.map(([id, label]) => `<button type="button" class="tab ${filter === id ? "active" : ""}" data-action="filter" data-filter="${id}" aria-pressed="${filter === id}">${label}</button>`).join("")}</div>
          <div class="filter-tools"><label class="search-box">${icon("search")}<input type="search" data-search placeholder="제목 검색" value="${escapeHtml(search)}" aria-label="공지 검색"></label><select class="plain-select" data-subject-filter aria-label="과목 선택"><option value="all">모든 과목</option>${subjects.map((subject) => `<option value="${escapeHtml(subject)}" ${subjectFilter === subject ? "selected" : ""}>${escapeHtml(subject)}</option>`).join("")}</select></div>
        </div>
        <div class="notice-list">${notices.length ? notices.map(renderNoticeRow).join("") : `<div class="empty-state">${icon("inbox")}<strong>표시할 공지가 없습니다</strong><p>검색어나 필터를 바꿔 보세요.</p></div>`}</div>
      </section>
      <aside class="aside-pane" aria-label="플래너 미리보기">
        <div class="section-heading"><h2>나의 플래너</h2><button type="button" class="icon-button" data-action="nav" data-view="planner" aria-label="플래너 열기" title="플래너 열기">${icon("arrow-up-right")}</button></div>
        ${renderCalendar()}
        <div class="aside-divider"></div>
        <div class="section-heading"><h3>${formatDate(selectedDate, { month: "long", day: "numeric", weekday: "long" })} 일정</h3><button type="button" class="icon-button" data-action="add-event" aria-label="일정 추가" title="일정 추가">${icon("plus")}</button></div>
        ${renderAgenda(selectedDate)}
      </aside>
    </div>`;
}

function renderPlanner() {
  const savedCount = calendarEvents().length;
  return `<div class="page-heading"><div><p class="eyebrow">MY PLANNER</p><h1>나의 플래너</h1></div><button type="button" class="button primary" data-action="add-event">${icon("plus")}<span class="label">일정 추가</span></button></div>
    <div class="planner-grid"><section class="pane" aria-label="월간 달력"><div class="section-heading"><h2>월간 일정</h2><span class="section-note">${savedCount}개 일정</span></div>${renderCalendar(true)}</section>
      <aside class="planner-side"><div class="section-heading"><h2>${formatDate(selectedDate, { month: "long", day: "numeric", weekday: "long" })}</h2></div>${renderAgenda(selectedDate)}</aside></div>`;
}

function renderGroupForm() {
  if (!groupFormOpen) return `<button type="button" class="button" data-action="toggle-group">${icon("plus")}그룹 만들기</button>`;
  return `<form id="group-form" class="group-form"><div class="field"><label for="group-name">그룹 이름</label><input id="group-name" name="name" placeholder="예: 2학년 3반" required maxlength="30"></div>
    <div class="field"><label for="group-kind">그룹 유형</label><select id="group-kind" name="kind"><option value="class">학급</option><option value="club">동아리</option></select></div>
    <div id="class-fields" class="field-grid"><div class="field"><label for="group-grade">학년</label><select id="group-grade" name="grade">${[1, 2, 3].map((n) => `<option value="${n}" ${n === 2 ? "selected" : ""}>${n}학년</option>`).join("")}</select></div><div class="field"><label for="group-classroom">반</label><input id="group-classroom" name="classroom" type="number" min="1" max="30" value="3"></div></div>
    <div id="club-fields" class="field" hidden><label for="group-club">동아리 이름</label><input id="group-club" name="clubName" placeholder="예: 방송부" maxlength="30"></div>
    <div class="form-actions"><button type="button" class="button" data-action="toggle-group">취소</button><button class="button primary" type="submit">그룹 저장</button></div></form>`;
}

function renderTeacher() {
  const editing = state.notices.find((notice) => notice.id === editingNoticeId);
  const notices = [...state.notices].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return `<div class="page-heading"><div><p class="eyebrow">TEACHER WORKSPACE</p><h1>공지 관리</h1></div><span class="badge">체험 모드</span></div>
    <div class="teacher-layout">
      <section class="teacher-left" aria-label="그룹 관리"><div class="section-heading"><h2>대상 그룹</h2><span class="section-note">${state.groups.length}개</span></div>
        <div class="group-list">${state.groups.map((group) => `<div class="group-row">${icon(group.kind === "class" ? "users-round" : "shapes")}<span>${escapeHtml(group.name)}</span><small>${group.kind === "class" ? "학급" : "동아리"}</small><button type="button" class="icon-button" data-action="delete-group" data-id="${escapeHtml(group.id)}" aria-label="${escapeHtml(group.name)} 삭제" title="그룹 삭제">${icon("trash-2")}</button></div>`).join("")}</div>
        ${renderGroupForm()}
      </section>
      <section class="pane" aria-label="공지 작성"><div class="section-heading"><h2>${editing ? "공지 수정" : "공지·과제 작성"}</h2></div>
        <form id="notice-form"><div class="field-grid">
          <div class="field full"><label for="notice-title">제목</label><input id="notice-title" name="title" required maxlength="80" placeholder="공지 제목을 입력하세요" value="${escapeHtml(editing?.title || "")}"></div>
          <div class="field"><label for="notice-type">종류</label><select id="notice-type" name="type"><option value="notice" ${editing?.type === "notice" ? "selected" : ""}>공지</option><option value="assignment" ${editing?.type === "assignment" ? "selected" : ""}>과제</option></select></div>
          <div class="field"><label for="notice-subject">과목·분류</label><input id="notice-subject" name="subject" required maxlength="25" placeholder="예: 국어, 학교" value="${escapeHtml(editing?.subject || "")}"></div>
          <div class="field full"><label for="notice-body">내용</label><textarea id="notice-body" name="body" required maxlength="3000" placeholder="전달할 내용을 입력하세요">${escapeHtml(editing?.body || "")}</textarea></div>
          <div class="field"><label for="notice-group">대상</label><select id="notice-group" name="groupId"><option value="all" ${!editing || editing.groupId === "all" ? "selected" : ""}>전체 학생</option>${state.groups.map((group) => `<option value="${escapeHtml(group.id)}" ${editing?.groupId === group.id ? "selected" : ""}>${escapeHtml(group.name)}</option>`).join("")}</select></div>
          <div class="field"><label for="notice-due">마감일</label><input id="notice-due" name="dueDate" type="date" value="${escapeHtml(editing?.dueDate || "")}"></div>
          <div class="field full"><label for="notice-file">첨부파일</label><input id="notice-file" name="attachment" type="file" accept=".pdf,.hwp,.hwpx,.png,.jpg,.jpeg"><span class="field-help">${editing?.attachment ? `현재 파일: ${escapeHtml(editing.attachment.name)} · ` : ""}1MB 이하 파일은 이 브라우저에 저장됩니다.</span></div>
        </div><div class="form-actions">${editing ? `<button type="button" class="button" data-action="cancel-edit">수정 취소</button>` : ""}<button type="submit" class="button primary">${icon(editing ? "save" : "send")} ${editing ? "변경 저장" : "공지 등록"}</button></div></form>
      </section>
    </div>
    <section class="teacher-recent" aria-label="최근 등록한 공지"><div class="section-heading"><h2>최근 등록한 공지·과제</h2><span class="section-note">${notices.length}개</span></div>
      <div style="overflow-x:auto"><table class="teacher-table"><thead><tr><th>제목</th><th>대상</th><th>마감일</th><th>관리</th></tr></thead><tbody>${notices.map((notice) => `<tr><td><button type="button" class="notice-title row-title" data-action="detail" data-id="${escapeHtml(notice.id)}">${escapeHtml(notice.title)}</button><div class="notice-meta"><span class="type-tag ${notice.type}">${notice.type === "assignment" ? "과제" : "공지"}</span><span>${escapeHtml(notice.subject)}</span></div></td><td>${escapeHtml(groupLabel(notice.groupId))}</td><td>${notice.dueDate ? formatDate(notice.dueDate) : "-"}</td><td><div class="table-actions"><button type="button" class="icon-button" data-action="edit-notice" data-id="${escapeHtml(notice.id)}" aria-label="수정" title="수정">${icon("pencil")}</button><button type="button" class="icon-button" data-action="delete-notice" data-id="${escapeHtml(notice.id)}" aria-label="삭제" title="삭제">${icon("trash-2")}</button></div></td></tr>`).join("")}</tbody></table></div>
    </section>`;
}

function renderDialogs() {
  const notice = state.notices.find((item) => item.id === activeDialog?.id);
  return `<dialog id="detail-dialog" aria-labelledby="detail-title">${notice ? `<div class="dialog-inner"><div class="dialog-header"><div><div class="dialog-meta"><span class="type-tag ${notice.type}">${notice.type === "assignment" ? "과제" : "공지"}</span><span class="subject-tag">${escapeHtml(notice.subject)}</span></div><h2 id="detail-title" style="margin-top:11px">${escapeHtml(notice.title)}</h2></div><button type="button" class="icon-button" data-action="close-dialog" aria-label="닫기" title="닫기">${icon("x")}</button></div><div class="dialog-meta"><span class="audience-tag">${escapeHtml(groupLabel(notice.groupId))}</span><span class="muted small">${notice.dueDate ? `마감 ${formatDate(notice.dueDate)}` : "마감일 없음"}</span></div><p class="dialog-body">${escapeHtml(notice.body)}</p>${notice.attachment ? `<a class="button" href="${escapeHtml(notice.attachment.dataUrl)}" download="${escapeHtml(notice.attachment.name)}">${icon("paperclip")} ${escapeHtml(notice.attachment.name)}</a>` : ""}<div class="dialog-actions"><button type="button" class="button" data-action="close-dialog">닫기</button>${notice.dueDate && mode === "student" ? `<button type="button" class="button primary" data-action="save-planner" data-id="${escapeHtml(notice.id)}">${icon("calendar-plus-2")}${state.savedNoticeIds.includes(notice.id) ? "플래너에서 제거" : "플래너에 추가"}</button>` : ""}</div></div>` : ""}</dialog>
    <dialog id="event-dialog" aria-labelledby="event-title"><div class="dialog-inner"><div class="dialog-header"><h2 id="event-title">일정 추가</h2><button type="button" class="icon-button" data-action="close-dialog" aria-label="닫기" title="닫기">${icon("x")}</button></div><form id="event-form" class="field-grid"><div class="field full"><label for="event-name">일정 이름</label><input id="event-name" name="title" required maxlength="70" placeholder="예: 수행평가 준비"></div><div class="field full"><label for="event-date">날짜</label><input id="event-date" name="date" type="date" required value="${selectedDate}"></div><div class="field full"><div class="dialog-actions"><button type="button" class="button" data-action="close-dialog">취소</button><button class="button primary" type="submit">일정 저장</button></div></div></form></div></dialog>
    <dialog id="profile-dialog" aria-labelledby="profile-title"><div class="dialog-inner"><div class="dialog-header"><h2 id="profile-title">학생 정보</h2><button type="button" class="icon-button" data-action="close-dialog" aria-label="닫기" title="닫기">${icon("x")}</button></div><form id="profile-form" class="field-grid"><div class="field full"><label for="profile-name">이름</label><input id="profile-name" name="name" required maxlength="20" value="${escapeHtml(state.profile.name)}"></div><div class="field"><label for="profile-grade">학년</label><select id="profile-grade" name="grade">${[1, 2, 3].map((n) => `<option value="${n}" ${state.profile.grade === n ? "selected" : ""}>${n}학년</option>`).join("")}</select></div><div class="field"><label for="profile-classroom">반</label><input id="profile-classroom" name="classroom" type="number" min="1" max="30" required value="${state.profile.classroom}"></div><div class="field full">${PlannerModel.clubCheckboxes(state.profile.clubs)}</div><div class="field full"><div class="dialog-actions"><button type="button" class="button" data-action="close-dialog">취소</button><button type="submit" class="button primary">저장</button></div></div></form></div></dialog>`;
}

function render() {
  root.innerHTML = `<div class="app-shell">${renderSidebar()}<div class="main-area">${renderTopbar()}<main class="workspace">${view === "feed" ? renderFeed() : view === "planner" ? renderPlanner() : renderTeacher()}</main></div></div>${renderDialogs()}`;
  globalThis.lucide?.createIcons({ attrs: { "stroke-width": 1.8 } });
  if (activeDialog?.type === "detail") root.querySelector("#detail-dialog")?.showModal();
  if (activeDialog?.type === "event") root.querySelector("#event-dialog")?.showModal();
  if (activeDialog?.type === "profile") root.querySelector("#profile-dialog")?.showModal();
}

function closeDialog() {
  activeDialog = null;
  root.querySelector("dialog[open]")?.close();
}

root.addEventListener("close", (event) => {
  if (event.target.matches("dialog")) activeDialog = null;
}, true);

function toggleInList(list, id) {
  return list.includes(id) ? list.filter((item) => item !== id) : [...list, id];
}

root.addEventListener("click", (event) => {
  const button = event.target.closest("[data-action]");
  if (!button) return;
  const { action, id } = button.dataset;
  if (action === "nav") { view = button.dataset.view; activeDialog = null; render(); return; }
  if (action === "logout") { window.dispatchEvent(new Event("planner-logout")); return; }
  if (action === "filter") { filter = button.dataset.filter; render(); return; }
  if (action === "month") {
    const [year, month] = calendarMonth.split("-").map(Number);
    selectedDate = dateKey(new Date(year, month - 1 + Number(button.dataset.direction), 1));
    calendarMonth = selectedDate.slice(0, 7);
    render(); return;
  }
  if (action === "date") { selectedDate = button.dataset.date; calendarMonth = selectedDate.slice(0, 7); render(); return; }
  if (action === "detail") { activeDialog = { type: "detail", id }; render(); return; }
  if (action === "add-event") { activeDialog = { type: "event" }; render(); return; }
  if (action === "profile") { activeDialog = { type: "profile" }; render(); return; }
  if (action === "close-dialog") { closeDialog(); return; }
  if (action === "save-planner") {
    const next = structuredClone(state);
    next.savedNoticeIds = toggleInList(next.savedNoticeIds, id);
    persist(next, next.savedNoticeIds.includes(id) ? "플래너에 추가했습니다." : "플래너에서 제거했습니다.");
    return;
  }
  if (action === "toggle-group") { groupFormOpen = !groupFormOpen; render(); return; }
  if (action === "delete-group") {
    if (state.notices.some((notice) => notice.groupId === id)) { showToast("이 그룹을 대상으로 한 공지를 먼저 수정해 주세요."); return; }
    if (confirm("이 그룹을 삭제할까요?")) { const next = structuredClone(state); next.groups = next.groups.filter((group) => group.id !== id); persist(next, "그룹을 삭제했습니다."); }
    return;
  }
  if (action === "edit-notice") { editingNoticeId = id; render(); window.scrollTo({ top: 0, behavior: "smooth" }); return; }
  if (action === "cancel-edit") { editingNoticeId = null; render(); return; }
  if (action === "delete-notice") {
    if (confirm("이 공지를 삭제할까요?")) {
      const next = structuredClone(state);
      next.notices = next.notices.filter((notice) => notice.id !== id);
      next.savedNoticeIds = next.savedNoticeIds.filter((item) => item !== id);
      next.completedNoticeIds = next.completedNoticeIds.filter((item) => item !== id);
      if (editingNoticeId === id) editingNoticeId = null;
      persist(next, "공지를 삭제했습니다.");
    }
    return;
  }
  if (action === "delete-event") {
    const next = structuredClone(state);
    next.personalEvents = next.personalEvents.filter((item) => item.id !== id);
    persist(next, "일정을 삭제했습니다.");
    return;
  }
  if (action === "remove-planner-notice") {
    const next = structuredClone(state);
    next.savedNoticeIds = next.savedNoticeIds.filter((item) => item !== id);
    persist(next, "플래너에서 제거했습니다. 원본 공지는 유지됩니다.");
    return;
  }
});

root.addEventListener("input", (event) => {
  if (!event.target.matches("[data-search]")) return;
  search = event.target.value;
  const position = event.target.selectionStart;
  render();
  const nextInput = root.querySelector("[data-search]");
  nextInput?.focus();
  nextInput?.setSelectionRange(position, position);
});

root.addEventListener("change", (event) => {
  const target = event.target;
  if (target.matches("[data-subject-filter]")) { subjectFilter = target.value; render(); return; }
  if (target.matches("[data-complete-notice]")) {
    const next = structuredClone(state);
    next.completedNoticeIds = toggleInList(next.completedNoticeIds, target.dataset.completeNotice);
    persist(next);
    return;
  }
  if (target.matches("[data-complete-event]")) {
    const next = structuredClone(state);
    const item = next.personalEvents.find((entry) => entry.id === target.dataset.completeEvent);
    if (item) item.done = !item.done;
    persist(next);
    return;
  }
  if (target.id === "group-kind") {
    root.querySelector("#class-fields").hidden = target.value !== "class";
    root.querySelector("#club-fields").hidden = target.value !== "club";
  }
});

function readAttachment(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve({ name: file.name, dataUrl: reader.result });
    reader.onerror = () => reject(new Error("파일을 읽을 수 없습니다."));
    reader.readAsDataURL(file);
  });
}

root.addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.target;
  const data = new FormData(form);
  if (form.id === "group-form") {
    const kind = String(data.get("kind"));
    const name = String(data.get("name")).trim();
    const group = { id: newId(), kind, name };
    if (kind === "class") {
      group.grade = Number(data.get("grade"));
      group.classroom = Number(data.get("classroom"));
      if (!Number.isInteger(group.classroom) || group.classroom < 1 || group.classroom > 30) { showToast("반을 1~30 사이로 입력해 주세요."); return; }
    }
    else { group.clubName = String(data.get("clubName")).trim(); if (!group.clubName) { showToast("동아리 이름을 입력해 주세요."); return; } }
    if (!name) return;
    const next = structuredClone(state);
    next.groups.push(group);
    groupFormOpen = false;
    persist(next, "그룹을 만들었습니다.");
    return;
  }
  if (form.id === "notice-form") {
    const title = String(data.get("title")).trim();
    const body = String(data.get("body")).trim();
    const subject = String(data.get("subject")).trim();
    if (!title || !body || !subject) { showToast("제목, 내용, 과목을 입력해 주세요."); return; }
    const file = data.get("attachment");
    if (file?.size > 1024 * 1024) { showToast("첨부파일은 1MB 이하로 선택해 주세요."); return; }
    const next = structuredClone(state);
    const original = next.notices.find((notice) => notice.id === editingNoticeId);
    let attachment = original?.attachment || null;
    if (file?.size) {
      try { attachment = await readAttachment(file); }
      catch { showToast("파일을 읽을 수 없습니다."); return; }
    }
    const notice = {
      id: original?.id || newId(), type: String(data.get("type")), subject, title, body,
      dueDate: String(data.get("dueDate")), groupId: String(data.get("groupId")),
      createdAt: original?.createdAt || new Date().toISOString(), attachment,
    };
    if (original) next.notices = next.notices.map((item) => item.id === original.id ? notice : item);
    else next.notices.unshift(notice);
    const message = original ? "공지를 수정했습니다." : "공지를 등록했습니다.";
    if (persist(next, message)) { editingNoticeId = null; render(); }
    return;
  }
  if (form.id === "event-form") {
    const title = String(data.get("title")).trim();
    const date = String(data.get("date"));
    if (!title || !date) return;
    const next = structuredClone(state);
    next.personalEvents.push({ id: newId(), title, date, done: false });
    selectedDate = date;
    calendarMonth = date.slice(0, 7);
    activeDialog = null;
    persist(next, "일정을 추가했습니다.");
    return;
  }
  if (form.id === "profile-form") {
    const next = structuredClone(state);
    next.profile = {
      ...next.profile,
      name: String(data.get("name")).trim(), grade: Number(data.get("grade")),
      classroom: Number(data.get("classroom")),
      clubs: data.getAll("clubs").filter(club => PlannerModel.CLUBS.includes(club)),
    };
    activeDialog = null;
    persist(next, "학생 정보를 저장했습니다.");
  }
});

window.addEventListener("planner-login", (event) => {
  const { user, profile, loginClub } = event.detail;
  accountStorageKey = `${STORAGE_KEY}:${user.id}`;
  let stored;
  try { stored = JSON.parse(localStorage.getItem(accountStorageKey)); state = restoreState(stored); }
  catch { state = createInitialState(); }
  if (!stored) state.profile = PlannerModel.applySignupProfile(state.profile, user.user_metadata);
  if (profile.role === "student" && (loginClub === "none" || PlannerModel.CLUBS.includes(loginClub))) {
    state.profile.clubs = loginClub === "none" ? [] : [loginClub];
    try { localStorage.setItem(accountStorageKey, JSON.stringify(state)); }
    catch { showToast("선택한 동아리를 브라우저에 저장하지 못했습니다."); }
  }
  state.profile.name = user.user_metadata?.display_name || profile.display_name || "학생";
  mode = profile.role === "teacher" ? "teacher" : "student";
  view = mode === "teacher" ? "teacher" : "feed";
  activeDialog = null;
  editingNoticeId = null;
  search = "";
  filter = "all";
  subjectFilter = "all";
  render();
});
