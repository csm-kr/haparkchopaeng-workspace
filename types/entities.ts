// 엔티티 DTO — DB.md 모델 대응. API 경계(직렬화·클라이언트 공유)용이라
// DateTime 필드는 ISO 8601 문자열로 둔다(Prisma 생성 타입과 별개, ADR-015).
import type { AnalysisPayloadMap } from "./analysis";
import type {
  AnalysisStatus,
  AssetType,
  Availability,
  InviteRole,
  JobStatus,
  JobType,
  Lens,
  NoteLens,
  Presence,
  Role,
  TeamRole,
  WeekStatus,
} from "./enums";

// --- 팀 / 인증 ---

export interface Member {
  id: string;
  name: string;
  handle: string;
  email: string;
  role: Role;
  /** CSS 토큰명 e.g. "var(--m-ha)" */
  color: string;
  initial: string;
  presence: Presence;
  status?: string | null;
  availability: Availability;
  createdAt: string;
}

/** 초대 토큰 (ADR-018) — 이메일 없음. role은 owner 불가(admin | member). */
export interface Invite {
  id: string;
  teamId: string;
  /** 랜덤 토큰(추측 불가). 표시용 프리뷰에는 재노출하지 않는다. */
  token: string;
  role: InviteRole;
  maxUses: number;
  usedCount: number;
  expiresAt: string;
  revokedAt?: string | null;
  usedAt?: string | null;
  /** Member.id */
  createdBy: string;
  createdAt: string;
}

// --- 멀티팀 (ADR-018) ---

export interface Team {
  id: string;
  /** 앱 검증: ^[a-z][a-z0-9-]{1,23}$ */
  slug: string;
  /** 앱 검증: 2–30자 */
  name: string;
  /** Member.id */
  createdBy: string;
  createdAt: string;
}

/** 팀 멤버십 — 복합 키 (teamId, memberId). 권한은 팀별 role로 분리 */
export interface Membership {
  teamId: string;
  /** Member.id */
  memberId: string;
  role: TeamRole;
  joinedAt: string;
}

/** 초대 토큰 합류 감사 로그 — owner는 부여 불가라 acceptedRole은 admin | member */
export interface TeamInviteAcceptance {
  id: string;
  inviteId: string;
  teamId: string;
  memberId: string;
  acceptedRole: TeamRole;
  acceptedAt: string;
}

// --- 논문 / 분석 ---

export interface Paper {
  id: string;
  title: string;
  authors: string;
  venue?: string | null;
  year?: number | null;
  arxiv?: string | null;
  pageCount?: number | null;
  abstract?: string | null;
  /** 원문 PDF 스토리지 경로(다운로드 유일 액션) */
  pdfUrl: string;
  /** Member.id */
  uploadedBy: string;
  uploadedAt: string;
  tags: string[];
  /** 업로드≠분석 — 분석 실패해도 Paper는 저장됨 (UX 분리) */
  analysisStatus: AnalysisStatus;
}

/** lens별로 payload가 결정되는 분석 (ADR-004) */
export interface Analysis<L extends Lens = Lens> {
  id: string;
  paperId: string;
  lens: L;
  payload: AnalysisPayloadMap[L];
}

/** Figure는 두 관점 공통(특정 lens에 속하지 않음, ADR-004) */
export interface Figure {
  id: string;
  paperId: string;
  title: string;
  caption: string;
  /** 평이한 언어 설명(해석) */
  interpretation: string;
  /** "원문 PDF p.N에서 추출" 출처 */
  sourcePage: number;
  /** 추출/렌더링 이미지. 없으면 수동 업로드 대기 */
  imageUrl?: string | null;
}

export interface SectionNote {
  id: string;
  paperId: string;
  /** "problem" | "contributions" | … | "figures" */
  sectionId: string;
  /** figures 노트는 항상 "any" (ADR-005) */
  lens: NoteLens;
  /** Member.id — 작성자 표기 필수(서버가 세션에서 주입) */
  authorId: string;
  title: string;
  body: string;
  createdAt: string;
}

// --- 발표 자료 / 댓글 ---

export interface Slide {
  title: string;
  subtitle?: string | null;
  body: string;
}

export interface Presentation {
  id: string;
  title: string;
  presenterId: string;
  date: string;
  duration?: string | null;
  slideCount: number;
  tags: string[];
  summary?: string | null;
  keypoints: string[];
  slides: Slide[];
}

export interface PresentationAsset {
  id: string;
  presentationId: string;
  name: string;
  type: AssetType;
  size: string;
  url: string;
}

export interface PresentationVersion {
  id: string;
  presentationId: string;
  ver: string;
  byId: string;
  note: string;
  createdAt: string;
}

export interface Reaction {
  id: string;
  commentId: string;
  memberId: string;
  emoji: string;
}

export interface Comment {
  id: string;
  presentationId: string;
  authorId: string;
  /** @멘션은 본문 내 토큰으로 보존 */
  body: string;
  /** 특정 슬라이드 참조(없으면 전체) */
  slide?: number | null;
  createdAt: string;
  reactions: Reaction[];
}

// --- 스케줄 / 책임 ---

export interface ScheduleWeek {
  id: string;
  monthId: string;
  week: number;
  date: string;
  time: string;
  presenterId?: string | null;
  topic?: string | null;
  confirmed: boolean;
  /** current는 파생이라 저장 안 함 */
  status: WeekStatus;
  presentationId?: string | null;
}

export interface ScheduleMonth {
  id: string;
  year: number;
  month: number;
  day: string;
  saved: boolean;
  /** 이 달 저장 후 다음 시작 인덱스(순번 전진 결과) */
  rotationPointerAfter: number;
  /** 낙관적 락 — 동시 편집 충돌 방지(저장 시 불일치면 409) */
  version: number;
  weeks: ScheduleWeek[];
}

export interface MemberLedger {
  id: string;
  year: number;
  memberId: string;
  count: number;
  missedPresenter: number;
  missedAbsent: number;
  paid: number;
}

export interface FineConfig {
  year: number;
  /** 발표자 불참 */
  finePresenter: number;
  /** 일반 불참 */
  fineAbsent: number;
  ledgers: MemberLedger[];
}

// --- 라이브 ---

export interface LiveSession {
  id: string;
  /** 동시 active 세션은 1개 — 앱 전역 live와 1:1 (ADR-001) */
  active: boolean;
  presenterId: string;
  cloudflareLiveInputId?: string | null;
  recordingUrl?: string | null;
  startedAt: string;
  endedAt?: string | null;
}

export interface Participant {
  id: string;
  liveSessionId: string;
  memberId: string;
  joinedAt: string;
  leftAt?: string | null;
}

// --- 백그라운드 잡 (ADR-013) ---

/** 잡 페이로드 — type에 따라 다름(예: { paperId }). 값은 앱에서 좁혀 사용. */
export type JobPayload = Record<string, unknown>;

export interface Job {
  id: string;
  type: JobType;
  status: JobStatus;
  payload: JobPayload;
  attempts: number;
  maxAttempts: number;
  lastError?: string | null;
  /** 재시도 백오프 */
  runAfter: string;
  /** 워커가 원자적으로 claim(중복 처리 방지) */
  claimedAt?: string | null;
  createdAt: string;
}
