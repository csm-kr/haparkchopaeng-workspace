// 유한 집합은 유니온 리터럴로 (CODING_CONVENTION §타입 규칙). DB.md의 String 필드 허용값과 1:1.

/** 논문 분석 두 관점 — research/repro 둘뿐 (ADR-004) */
export type Lens = "research" | "repro";

/** 섹션 노트 스코프 관점. figure 노트는 항상 "any" (ADR-005) */
export type NoteLens = Lens | "any";

/** 멤버 역할 (ADR-007) */
export type Role = "관리자" | "멤버" | "게스트";

/** 팀별 역할 (ADR-018). owner는 초대 부여 불가·팀당 ≥ 1. UI 표기도 영어 그대로. */
export type TeamRole = "owner" | "admin" | "member";

/** 초대로 부여 가능한 역할 — owner는 초대 불가(ADR-018) */
export type InviteRole = Exclude<TeamRole, "owner">;

/** 멤버 접속 상태 */
export type Presence = "online" | "away" | "busy" | "offline";

/** 멤버 가용성 — vacation이면 순번 배정 시 건너뜀 */
export type Availability = "active" | "vacation";

/** 주차 상태. "current"는 파생(첫 비-done 주차)이라 저장하지 않음 — DB.md */
export type WeekStatus = "done" | "upcoming";

/** 논문 분석 상태 — 업로드≠분석 분리 (UX, DB.md) */
export type AnalysisStatus = "pending" | "ready" | "failed";

/** 백그라운드 잡 종류 (ADR-013) */
export type JobType = "analyze_paper" | "fetch_arxiv" | "process_recording";

/** 백그라운드 잡 상태 */
export type JobStatus = "queued" | "running" | "done" | "failed";

/** 초대 토큰 프리뷰 상태 — getInviteForAcceptance가 파생 계산 (ADR-018) */
export type InviteStatus = "not_found" | "revoked" | "expired" | "used_up" | "ready";

/** 발표 자료 에셋 종류 — DB.md PresentationAsset.type */
export type AssetType = "pdf" | "ppt" | "note";
