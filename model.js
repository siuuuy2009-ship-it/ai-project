const PlannerModel = (() => {
const STORAGE_KEY = "school-planner-demo-v1";
const CLUBS = Object.freeze(["파이", "시그마", "메트릭스", "라이프", "바이오", "캠", "별누리", "무한상상", "CC", "첼C", "블리츠", "파인애플"]);

function clubCheckboxes(selected = []) {
  return `<fieldset class="club-options"><legend>동아리 (선택)</legend>${CLUBS.map(name => `<label><input type="checkbox" name="clubs" value="${name}" ${selected.includes(name) ? "checked" : ""}> ${name}</label>`).join("")}</fieldset>`;
}

function dateKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function offsetDate(days, from = new Date()) {
  const date = new Date(from.getFullYear(), from.getMonth(), from.getDate() + days);
  return dateKey(date);
}

function localNoon(key) {
  const [year, month, day] = key.split("-").map(Number);
  return new Date(year, month - 1, day, 12);
}

function daysUntil(key, from = new Date()) {
  if (!key) return null;
  return Math.round((localNoon(key) - localNoon(dateKey(from))) / 86400000);
}

function matchesAudience(notice, profile, groups) {
  const ids = audienceIds(notice);
  if (ids.includes("all")) return true;
  return groups.some(group => ids.includes(group.id) && (group.kind === "class"
    ? Number(profile.grade) === Number(group.grade) && Number(profile.classroom) === Number(group.classroom)
    : group.kind === "club" && profile.clubs.includes(group.clubName)));
}

function audienceIds(notice) {
  return Array.isArray(notice.groupIds) ? [...new Set(notice.groupIds)] : notice.groupId ? [notice.groupId] : [];
}

function schoolGroups() {
  return [
    ...[1, 2, 3].flatMap(grade => [1, 2, 3, 4, 5, 6].map(classroom => ({
      id: `class-${grade}-${classroom}`, kind: "class", name: `${grade}학년 ${classroom}반`, grade, classroom, builtIn: true,
    }))),
    ...CLUBS.map((clubName, index) => ({ id: `school-club-${index + 1}`, kind: "club", name: clubName, clubName, builtIn: true })),
  ];
}

function mergeSchoolGroups(groups) {
  const result = groups.map(group => ({ ...group }));
  for (const standard of schoolGroups()) {
    const existing = result.find(group => group.id === standard.id || (group.kind === standard.kind && (group.kind === "class"
      ? Number(group.grade) === standard.grade && Number(group.classroom) === standard.classroom
      : group.clubName === standard.clubName)));
    if (existing) existing.builtIn = true;
    else result.push(standard);
  }
  return result;
}

function sortByDeadline(notices) {
  return [...notices].sort((a, b) => {
    if (!a.dueDate && !b.dueDate) return b.createdAt.localeCompare(a.createdAt);
    if (!a.dueDate) return 1;
    if (!b.dueDate) return -1;
    return a.dueDate.localeCompare(b.dueDate) || b.createdAt.localeCompare(a.createdAt);
  });
}

function visibleNotices(state) {
  return sortByDeadline(state.notices.filter((notice) =>
    matchesAudience(notice, state.profile, state.groups)
  ));
}

function createInitialState(now = new Date()) {
  const createdAt = now.toISOString();
  return {
    profile: { name: "학생", grade: 2, classroom: 3, clubs: ["파이"] },
    groups: schoolGroups(),
    notices: [
      {
        id: "sample-1", type: "assignment", subject: "국어", title: "독서 기록장 제출",
        body: "이번 주 읽은 책의 인상 깊은 문장과 감상을 정리해 제출하세요.",
        dueDate: offsetDate(2, now), groupId: "class-2-3", createdAt, attachment: null,
      },
      {
        id: "sample-2", type: "assignment", subject: "수학", title: "함수 단원 연습문제",
        body: "교과서 82~85쪽 문제를 풀어 오세요.",
        dueDate: offsetDate(5, now), groupId: "all", createdAt, attachment: null,
      },
      {
        id: "sample-3", type: "notice", subject: "학교", title: "다음 주 학사 일정 안내",
        body: "다음 주 학교 일정과 준비물을 확인해 주세요.",
        dueDate: offsetDate(7, now), groupId: "all", createdAt, attachment: null,
      },
      {
        id: "sample-4", type: "assignment", subject: "동아리", title: "파이 회의 안건 정리",
        body: "다음 회의에서 논의할 안건을 각자 한 가지씩 준비해 주세요.",
        dueDate: offsetDate(3, now), groupId: "school-club-1", createdAt, attachment: null,
      },
      {
        id: "sample-5", type: "notice", subject: "과학", title: "2학년 4반 실험실 이용 안내",
        body: "실험실 안전 수칙을 확인해 주세요.",
        dueDate: "", groupId: "class-2-4", createdAt, attachment: null,
      },
    ],
    savedNoticeIds: ["sample-1", "sample-4"],
    completedNoticeIds: [],
    personalEvents: [],
  };
}

function restoreState(raw) {
  if (!raw || !Array.isArray(raw.notices) || !Array.isArray(raw.groups)) {
    return createInitialState();
  }
  const fresh = createInitialState();
  return {
    profile: { ...fresh.profile, ...raw.profile, clubs: raw.profile?.clubs || [] },
    groups: mergeSchoolGroups(raw.groups),
    notices: raw.notices,
    savedNoticeIds: Array.isArray(raw.savedNoticeIds) ? raw.savedNoticeIds : [],
    completedNoticeIds: Array.isArray(raw.completedNoticeIds) ? raw.completedNoticeIds : [],
    personalEvents: Array.isArray(raw.personalEvents) ? raw.personalEvents : [],
  };
}

function applySignupProfile(profile, metadata = {}) {
  const next = { ...profile };
  if ([1, 2, 3].includes(metadata.grade)) next.grade = metadata.grade;
  if (Number.isInteger(metadata.classroom) && metadata.classroom >= 1 && metadata.classroom <= 30) next.classroom = metadata.classroom;
  if (typeof metadata.student_number === "string" && /^[0-9]{1,10}$/.test(metadata.student_number)) next.studentNumber = metadata.student_number;
  if (Array.isArray(metadata.clubs)) next.clubs = [...new Set(metadata.clubs.filter(value => typeof value === "string" && value.trim().length > 0 && value.length <= 30).map(value => value.trim()))].slice(0, 10);
  return next;
}

return {
  STORAGE_KEY, CLUBS, clubCheckboxes, dateKey, offsetDate, daysUntil, matchesAudience, audienceIds, schoolGroups, mergeSchoolGroups,
  sortByDeadline, visibleNotices, createInitialState, restoreState, applySignupProfile,
};
})();

globalThis.PlannerModel = PlannerModel;
if (typeof module !== "undefined") module.exports = PlannerModel;
