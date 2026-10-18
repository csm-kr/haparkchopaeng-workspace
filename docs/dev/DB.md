# 데이터베이스 설계 (DB)

> 아키텍처 전반은 [`./ARCHITECTURE.md`](./ARCHITECTURE.md), 접근 경로는 [`./API.md`](./API.md), 앱 상태는 [`../agent/STATE.md`](../agent/STATE.md)를 본다. 데이터의 출처(프로토타입 목)는 `src/data.js`다. 이 문서는 그 목 데이터를 **타입드 영속 모델**로 정규화한 것이다.

## 스택 결정

- **ORM:** Prisma
- **DB:** **Supabase Postgres**(개발·운영 공통, ADR-016). `provider="postgresql"` + `directUrl`(마이그레이션/`db push`). 초기 스키마는 `prisma db push`로 동기화(Supabase shadow DB 권한 이슈 회피); prod 마이그레이션 파일은 추후 정식화.
- (이력) 시작은 SQLite였으나 Supabase 채택으로 Postgres로 전환(ADR-010→016).
- **멀티팀(ADR-018→020):** `Member`는 여러 `Team`에 속할 수 있고, 도메인 엔티티(`Paper`·`Presentation`·`ScheduleMonth`·`FineConfig`·`MemberLedger`·`LiveSession`)는 `teamId`로 스코핑된다. (단일 테넌트 `Workspace` 전제는 ADR-007→018에서 폐기.)
- **CRITICAL — 팀 스코핑 운영 반영은 검토된 수동 단계(ADR-020):** `teamId` 컬럼 추가 + 제약/PK 변경 + 기존 행 백필을 담은 `prisma db push`(실 반영)는 **공유 운영 DB**라 코드와 분리해 사람이 검토 후 실행한다. harness step은 스키마·백필·테스트 코드까지만 만든다. 기존 행은 전부 부트스트랩된 "하박조팽" 팀(가장 먼저 생성된 팀)으로 백필하며 멱등이어야 한다.
- **CRITICAL — NEWS 출판 실적(ADR-022):** 새 `Publication` 모델(`teamId` 스코핑)을 추가한다 — `Paper`(분석 대상)와 분리. **신규 테이블이라 백필 대상 기존 행이 없으나**, 공유 운영 DB에 실제 `prisma db push`(반영)는 harness step이 아니라 **사람이 검토 후 수동 실행**한다(harness는 스키마·코드·테스트까지만). 위 ADR-020 수동 push 정신과 동일.

### SQLite 제약 (구현 시 주의)
- **`enum` 미지원.** 역할·관점·상태 등은 `String`으로 저장하고 애플리케이션 레이어(zod 등)에서 검증한다. 허용값은 각 필드 주석에 명시.
- **`Json` 타입은 지원**되지만 DB 레벨 쿼리는 제한적. 중첩 분석 페이로드는 `Json`으로 저장하고 앱에서 파싱한다.
- **배열 스칼라 미지원.** `tags` 같은 목록은 별도 테이블 또는 `Json`/구분자 문자열로.

## ERD (개념)

```
Workspace 1──* Member 1──* SectionNote
                  │  └──* Comment ─*1 Presentation
                  │  └──* Reaction
                  ├──* Paper 1──* Analysis(lens)
                  │            1──* Figure
                  │            1──* SectionNote
                  ├──* Presentation 1──* PresentationAsset
                  │                 1──* PresentationVersion
                  │                 1──* Comment
                  ├──* Publication            (NEWS 출판 실적, ADR-022)
                  ├──* ScheduleWeek *──1 ScheduleMonth
                  ├──* MemberLedger *──1 FineConfig(year)
                  └──* Participant  *──1 LiveSession
Workspace 1──* Invite
```

## 스키마 (Prisma, 시그니처 수준)

> 아래는 모델 **구조와 핵심 제약**만 제시한다. 실제 `schema.prisma`의 인덱스·기본값·관계 옵션 세부는 구현자 재량. 단, 주석의 **CRITICAL 제약은 반드시 지킨다.**

```prisma
model Workspace {
  id        String  @id @default(cuid())
  name      String  // "하박조팽"
  slug      String  @unique // "habakjopaeng"
  seats     Int     @default(8)
  createdAt DateTime @default(now())
  // CRITICAL: row는 단 하나만 존재 — 멀티테넌트 아님(ADR-007)
}

model Member {
  id         String  @id           // "ha" | "bak" | "jo" | "paeng" …
  name       String
  handle     String  @unique       // "@hajieun"
  email      String  @unique
  role       String                // 관리자 | 멤버 | 게스트 (앱에서 검증)
  color      String                // CSS 토큰명 e.g. "var(--m-ha)"
  initial    String
  presence   String  @default("offline") // online | away | busy | offline
  status     String?
  availability String @default("active") // active | vacation
  createdAt  DateTime @default(now())
}

model Invite {
  id        String  @id @default(cuid())
  email     String
  role      String                // 초대 시 부여할 역할
  status    String  @default("pending") // pending | accepted | revoked
  invitedBy String                // Member.id
  createdAt DateTime @default(now())
  // CRITICAL: 합류는 초대 토큰 검증을 통해서만(공개 가입 없음, ADR-007)
}

model Paper {
  id         String  @id @default(cuid())
  teamId     String                // Team.id — CRITICAL: 활성 팀 스코핑(ADR-020, R37)
  title      String
  authors    String
  venue      String?
  year       Int?
  arxiv      String?               // "2404.02258"
  pageCount  Int?
  abstract   String?
  pdfUrl     String                // 원문 PDF 스토리지 경로 (다운로드 유일 액션)
  uploadedBy String                // Member.id
  uploadedAt DateTime @default(now())
  tags       Json                  // string[]
  analysisStatus String @default("pending") // pending | awaiting_ai | ready | failed
  sourceText        String? // JSON [{page,text}], 페이지 원문. 본문 합계 최대 120000자
  sourceDigest      String? // 원문 PDF SHA256
  analysisRequestId String? // 현재 Job 실행 ID. 이전 실행의 늦은 저장을 차단
  analysisError     String? // 정규화한 사용자 안내(원시 오류·CLI stderr 금지)
  analyses   Analysis[]
  figures    Figure[]
  notes      SectionNote[]
  @@index([teamId])
  // CRITICAL: 업로드는 PDF 전용(ADR-003). kind 같은 타입 필드 두지 말 것.
  // CRITICAL: 분석 실패가 Paper 저장을 막지 않는다 — analysisStatus=failed로 두고 재시도(API /reanalyze).
  // CRITICAL: 모든 조회·변이는 활성 팀(teamId)으로 스코핑(ADR-020, R37).
}

model Analysis {
  id      String @id @default(cuid())
  paperId String
  paper   Paper  @relation(fields: [paperId], references: [id], onDelete: Cascade)
  lens    String // research | repro  (CRITICAL: 두 관점만, ADR-004)
  payload Json   // 관점별 구조화 필드 전체(problem/contributions/io/comparison/ablation | data/model/loss/metrics/training/gpu)
  @@unique([paperId, lens])
}

model Figure {
  id             String @id @default(cuid())
  paperId        String
  paper          Paper  @relation(fields: [paperId], references: [id], onDelete: Cascade)
  title          String // "Figure 1 — Routing 개요"
  caption        String
  interpretation String // 평이한 언어 설명(해석)
  sourcePage     Int    // "원문 PDF p.N에서 추출" 출처
  imageUrl       String?// 추출/렌더링된 figure 이미지 (없으면 수동 업로드 대기)
  // CRITICAL: Figure는 두 관점 공통(특정 lens에 속하지 않음, ADR-004)
}

model SectionNote {
  id        String @id @default(cuid())
  paperId   String
  paper     Paper  @relation(fields: [paperId], references: [id], onDelete: Cascade)
  sectionId String // "problem" | "contributions" | … | "figures"
  lens      String // research | repro | any   (figures 노트는 항상 any, ADR-005)
  authorId  String // Member.id — CRITICAL: 작성자 표기 필수
  title     String
  body      String
  createdAt DateTime @default(now())
  @@index([paperId, sectionId, lens])
}

model Presentation {
  id          String @id @default(cuid())
  teamId      String               // Team.id — CRITICAL: 활성 팀 스코핑(ADR-020, R37)
  title       String
  presenterId String
  date        DateTime
  duration    String?              // "30분"
  slideCount  Int    @default(0)
  tags        Json                 // string[]
  summary     String?
  keypoints   Json                 // string[]
  slides      Json                 // [{title, subtitle?, body}]
  assets      PresentationAsset[]
  versions    PresentationVersion[]
  comments    Comment[]
  @@index([teamId])
}

model PresentationAsset {
  id             String @id @default(cuid())
  presentationId String
  presentation   Presentation @relation(fields: [presentationId], references: [id], onDelete: Cascade)
  name           String
  type           String // pdf | ppt | note
  size           String
  url            String
}

model PresentationVersion {
  id             String @id @default(cuid())
  presentationId String
  presentation   Presentation @relation(fields: [presentationId], references: [id], onDelete: Cascade)
  ver            String // "v3"
  byId           String
  note           String
  createdAt      DateTime @default(now())
}

model Comment {
  id             String @id @default(cuid())
  presentationId String
  presentation   Presentation @relation(fields: [presentationId], references: [id], onDelete: Cascade)
  authorId       String
  body           String       // @멘션은 본문 내 토큰으로 보존
  slide          Int?         // 특정 슬라이드 참조(없으면 전체)
  createdAt      DateTime @default(now())
  reactions      Reaction[]
  // 회고 댓글은 발표 자료에 귀속(ADR-004: 논문 상세엔 댓글 패널 없음)
}

model Reaction {
  id        String @id @default(cuid())
  commentId String
  comment   Comment @relation(fields: [commentId], references: [id], onDelete: Cascade)
  memberId  String
  emoji     String
  @@unique([commentId, memberId, emoji])
}

model ScheduleMonth {
  id                 String @id @default(cuid())
  teamId             String  // Team.id — CRITICAL: 활성 팀 스코핑(ADR-020, R37)
  year               Int
  month              Int
  day                String @default("토요일")
  saved              Boolean @default(false)
  rotationPointerAfter Int   // 이 달 저장 후 다음 시작 인덱스(순번 전진 결과)
  version            Int @default(0) // 낙관적 락 — 두 관리자 동시 편집 충돌 방지
  weeks              ScheduleWeek[]
  @@unique([teamId, year, month])  // CRITICAL: 팀별 독립(ADR-020) · 자동 생성 금지 — row 부재 = 빈 달(ADR-006)
  @@index([teamId])
  // 저장 시 version 불일치면 409 "다른 사람이 먼저 저장했어요" (API: If-Match)
}

model ScheduleWeek {
  id             String @id @default(cuid())
  monthId        String
  month          ScheduleMonth @relation(fields: [monthId], references: [id], onDelete: Cascade)
  week           Int
  date           String // "6월 14일"
  time           String // "10:00"
  presenterId    String?
  topic          String?
  confirmed      Boolean @default(false)
  status         String  @default("upcoming") // done | upcoming (current는 파생)
  presentationId String?
}

model FineConfig {
  teamId        String              // Team.id — CRITICAL: 활성 팀 스코핑(ADR-020, R37)
  year         Int
  finePresenter Int  @default(30000) // 발표자 불참
  fineAbsent    Int  @default(10000) // 일반 불참
  ledgers      MemberLedger[]
  @@id([teamId, year])  // CRITICAL: 팀별 독립(ADR-020) — 기존 year 단독 PK 폐기
  @@index([teamId])
}

model MemberLedger {
  id              String @id @default(cuid())
  teamId          String  // Team.id — CRITICAL: 활성 팀 스코핑(ADR-020, R37)
  year            Int
  config          FineConfig @relation(fields: [teamId, year], references: [teamId, year])
  memberId        String
  count           Int @default(0) // 참여
  missedPresenter Int @default(0)
  missedAbsent    Int @default(0)
  paid            Int @default(0)
  @@unique([teamId, year, memberId])  // CRITICAL: 팀별 독립(ADR-020)
  @@index([teamId])
  // 누적 벌금 = missedPresenter*finePresenter + missedAbsent*fineAbsent (파생, 저장 안 함)
}

model LiveSession {
  id                  String @id @default(cuid())
  teamId              String  // Team.id — CRITICAL: 활성 팀 스코핑(ADR-020, R37)
  active              Boolean @default(true)
  presenterId         String
  cloudflareLiveInputId String?   // Cloudflare Stream Live Input UID
  recordingUrl        String?     // 종료 후 녹화본(보존 정책은 ISSUES 참조)
  startedAt           DateTime @default(now())
  endedAt             DateTime?
  participants        Participant[]
  @@index([teamId])
  // CRITICAL: 동시 active 세션은 팀당 1개 — 팀 전역 live 상태와 1:1 매핑(ADR-020이 ADR-019 "전역 1개" 개정)
}

model Participant {
  id            String @id @default(cuid())
  liveSessionId String
  session       LiveSession @relation(fields: [liveSessionId], references: [id], onDelete: Cascade)
  memberId      String
  joinedAt      DateTime @default(now())
  leftAt        DateTime?
  @@unique([liveSessionId, memberId])
}

model Job {
  id          String @id @default(cuid())
  type        String   // prepare_local_analysis | fetch_arxiv | process_recording (analyze_paper는 레거시)
  status      String @default("queued") // queued | running | done | failed
  payload     Json     // { paperId } 등
  attempts    Int @default(0)
  maxAttempts Int @default(3)
  lastError   String?
  runAfter    DateTime @default(now()) // 재시도 백오프
  claimedAt   DateTime?               // 워커가 원자적으로 claim(중복 처리 방지)
  createdAt   DateTime @default(now())
  @@index([status, runAfter])
  // 분 단위 작업은 외부 durable 잡 러너(Inngest/Trigger.dev/QStash)가 실행하고,
  // 이 테이블은 그 상태 미러(멱등·재시도·실패 보존)로 둔다(ADR-013→016).
}

model Publication {
  id          String   @id @default(cuid())
  teamId      String   @default("") // Team.id — CRITICAL: 활성 팀 스코핑(ADR-020/R37). default ""는 백필 sentinel(쓰기 시 명시 주입)
  title       String
  authors     String   // 자유 텍스트(쉼표 구분). 렌더 시 Member.name 일치 팀원만 강조(Member FK 없음 — YAGNI)
  venue       String   // 학회/저널명 (예: "NeurIPS 2025")
  year        Int      // 정렬·그룹화 기준
  month       Int?     // 1–12, 선택(없으면 연도만 표시)
  teaserImage String?  // 스토리지 객체 키(news/ 접두) — 비공개 버킷 + 서명 URL(R36). 없으면 플레이스홀더
  links       Json     // [{ label, url }] — arXiv/PDF/코드/프로젝트
  createdBy   String   // Member.id — CRITICAL: 작성자는 세션에서 주입(R3)
  createdAt   DateTime @default(now())
  @@index([teamId])
  // CRITICAL: NEWS는 분석 대상이 아니다 — analyses/figures/notes를 붙이지 마라(Paper와 의미 분리, ADR-022).
  // CRITICAL: 모든 조회·변이는 활성 팀(teamId)으로 스코핑(ADR-020, R37). 쓰기 teamId·createdBy는 서버 주입.
  // CRITICAL: 신규 테이블 — 운영 db push는 harness가 아니라 사람이 검토 후 수동(ADR-020 정신).
}
```

## 파생값 (저장하지 않고 계산)

| 값 | 계산식 | 위치 |
|---|---|---|
| 멤버 누적 벌금 | `missedPresenter*finePresenter + missedAbsent*fineAbsent` | 서버/클라 |
| 미납액 | `누적벌금 - paid` (≤0이면 "완납") | 서버/클라 |
| 주차 `current` 상태 | 첫 번째 비-`done` 주차 | 클라이언트 |
| 앱 전역 `live` | `LiveSession.active == true` 존재 여부 | 서버→클라 |

> **장부 채우는 법(런타임):** `FineConfig`는 관리자가 **명시 생성**한다(조회가 자동 생성하지 않음 — row 부재 = 미설정, ADR-006/R15). `MemberLedger`(참여·발표자 불참·일반 불참·납부)는 관리자가 **수동 편집으로 upsert**한다(스케줄 자동 집계 아님 — ADR-023). 위 모델 시그니처는 변경 없음(이미 존재). 누적 벌금·미납은 표대로 파생(저장 안 함).

## 시드 데이터

`src/data.js`의 `window.TEAM/PAPERS/PRESENTATIONS/SCHEDULE/SEMINAR_STATS/ANALYSIS/PRES_EXTRA` 등을 시드 스크립트(`prisma/seed.ts`)로 옮긴다. 멤버 4인·논문 5건·발표 자료 3건·6월 스케줄·2026 장부가 최소 시드.

## 주의 (Don'ts)

- **`ScheduleMonth`를 미리 만들지 마라.** 이유: row 부재가 "빈 달"의 진짜 표현이다. 미리 생성하면 유령 일정이 된다(ADR-006).
- **`Paper`에 타입/형식 필드를 두지 마라.** 이유: PDF 전용이므로 분기가 없다(ADR-003).
- **논문에 댓글 테이블을 붙이지 마라.** 이유: 회고 댓글은 발표 자료 귀속, 논문 상세엔 댓글 패널이 없다(ADR-004).

## 로컬 AI 연결 (ADR-025)

`LocalAgentDevice`·`LocalAgentAttempt`·`LocalAgentGrant`·`LocalAgentSnapshot`·`LocalAgentJob` 다섯 모델은 팀에 귀속되고 팀 삭제 시 cascade된다. 요청·허가·작업은 member/session에도 스코프한다. 기기 키·launch token·확인 번호는 해시로만 저장한다. `sessionExpiresAt`은 확인 번호가 실제 웹 쿠키보다 오래 유효하지 않게 한다. grant lease와 job version/eventSequence/CAS로 중복 실행·만료 후 결과를 막는다. 멤버 제거는 관련 권한 회수와 같은 트랜잭션으로 처리한다. 공유 운영 DB 적용은 사람의 검토·수동 실행 대상이며 자동 테스트는 일회용 DB만 사용한다. [계약·검증](./LOCAL_AGENT.md).

<a id="local-ai-schema"></a>
## 연구 분석·채팅 확장 (ADR-026)

스키마 정본은 [prisma/schema.prisma](../../prisma/schema.prisma)다. 기존 모델·관점·섹션 노트·관리자 설정을 보존하고 다음 항목만 추가한다.

| 대상 | 추가 항목·의미 |
|---|---|
| `Paper` | `sourceText` 페이지별 원문 JSON, `sourceDigest` PDF SHA256, `analysisRequestId` 최신 실행, `analysisError` 사용자 안내 |
| `LocalAgentJob` | `purpose` 기본 `question`(`paper_analysis|chat` 추가), nullable `conversationId/conversationTurn` |
| `ResearchConversation` | `id/teamId/memberId/title/paperIds/createdAt/updatedAt`, `jobs` 관계 |

`ResearchConversation.teamId`는 `Team` 삭제 시 cascade되고 소유자는 서버 세션에서 주입한다. `paperIds`는 검증된 같은 팀 논문 1~3개의 JSON 배열이며 임의 context를 저장하지 않는다. 목록 조회 인덱스는 `(memberId,teamId,updatedAt)`이다. `LocalAgentJob.conversationId` 관계는 대화 삭제 시 `SetNull`, `(conversationId,conversationTurn)`은 고유 제약이다. 대화 행 잠금으로 서로 다른 PC·세션의 동시 질문도 하나만 접수한다. 기존 질문/분석 작업의 nullable 대화 필드는 이 고유 제약에 묶이지 않는다.

명시적 논문 분석은 `Job(type=prepare_local_analysis)`에 서버가 고정한 논문·활성 팀·소유자·세션·실행 선택을 기록한다. Inngest 이벤트에는 실행 식별자를 전달하고 원문·기기 자격은 공개하지 않는다. 본문 준비는 추론 없이 `sourceText/sourceDigest`를 캐시하고 `awaiting_ai`로 전환한다. 분석 결과는 strict JSON·원문 페이지/인용 검사 후 최신 `analysisRequestId`에만 CAS 저장하며 두 관점·Figure·상태 전이를 한 트랜잭션으로 처리한다. 실패·취소·이전 실행은 기존 검증된 분석과 사용자 노트를 덮지 않는다.

개인 대화는 작업의 `prompt/response/status`를 턴 이력으로 재사용한다. 조회는 활성 팀+소유자, 실행/취소는 현재 세션으로 제한한다. 최근 목록 100개·대화 50턴을 반환하며, 모델에는 완료된 최근 8턴과 원문 최대 20만 자를 넣고 잘림을 표시한다. 유효 grant 중 서버가 접수한 완료 결과는 로그아웃 후 영속할 수 있지만, 새 실행 권한은 부여하지 않는다. 분석 최종 저장 시 현재 팀 멤버십을 다시 확인한다.

운영 DB에는 아직 적용하지 않았다. 추가 전체 품질 검증과 SQL 검토가 진행 중이다. 적용 순서는 다음과 같다.

1. 대상 프로젝트·데이터베이스·스키마와 백업/복구 지점을 확인하고 읽기 전용으로 현재 스키마·인덱스·제약을 정본과 비교한다. 최신 `AppSetting` 등 기존 운영 모델을 보존한다.
2. 미적용 상태라면 기존 연결 5개 테이블의 [20261017-local-agent-connection.sql](./sql/20261017-local-agent-connection.sql)을 먼저 검토·수동 적용한다. 이미 적용됐다면 실제 drift를 확인하고 중복 실행하지 않는다.
3. 이어 [20261017-local-ai-research-chat.sql](./sql/20261017-local-ai-research-chat.sql)로 위 추가 테이블·컬럼·관계·고유 제약을 검토·수동 적용한다. 일회용 PostgreSQL의 SQL 적용·drift 검증 성공을 운영 적용과 구분한다.
4. 반영 후 읽기 전용 drift 확인과 권한·소스 준비·선택 모델 분석·개인 채팅의 제한된 검증을 한다. 코드 롤백 시 추가 테이블·사용자 이력은 보존하며 자동 `DROP`/리셋을 수행하지 않는다.

공유 운영 DB에서 `prisma db push`·`seed`로 이 단계를 대체하지 않는다. 구체적 대상 확인·서명·설치 파일·배포·롤백 절차는 [운영 런북](./LOCAL_AGENT_RELEASE.md)을 따른다.

## 대화형 PT 상태·출력 (ADR-032)

phase 20의 AgentTask/AgentOperation/Presentation.sourcePaperId 스키마를 재사용한다. guided 세미나의 draft는 version=1,type=paper_pt인 JSON wrapper로 브리프·질문·방향·목차·덱·개인 대화를 보존한다. 기존 노트·직접 세미나 draft JSON은 그대로 읽는다. 새 테이블·컬럼·SQL은 없다.

Job.type=seminar_export의 payload는 version, taskId, teamId, memberId, paperId, sourceRevision, draftHash, draft, expectedVersion과 완료 files/qa다. Job.id는 검증한 요청 UUID다. AgentOperation.kind=export/tool=seminar.export가 Job ID를 연결한다. 파일은 비공개 `seminars/<team>/<member>/<task>/<job>/<server-random>.pdf/html`에 저장하며 DTO에 객체 키를 반환하지 않는다. 검토 등록 또는 동일한 등록본의 후속 출력 완료 때 PresentationAsset.type=pdf/html로 연결한다. html은 생성물 전용이며 업로드는 계속 PDF만 받는다. 잡 상태는 queued/running/done/failed이며 소유 작업 삭제·원문 변경·멤버십 상실은 새 결과 노출을 막는다.

## 목표 작업 스키마 (ADR-031)

`AgentTask`·`AgentOperation`과 `Presentation.sourcePaperId`를 추가한다. 팀·소유자·요청 UUID, revision별 operation key, PC job ID에 고유 제약을 둔다. 팀 삭제 시 작업/원장은 cascade, 원문 삭제 시 발표 자료의 연결만 SetNull이다.

새 웹은 발표 조회에도 새 관계를 사용하므로 **플래그가 꺼져 있어도 새 스키마가 먼저 필요하다**. [20261018-agent-centric-foundation.sql](./sql/20261018-agent-centric-foundation.sql)을 기존 연결·연구 채팅 SQL 이후 검토·적용한다. 이 phase는 운영 DB에 적용하지 않는다. 운영 `db push/seed`로 대체하지 않는다. 롤백 시 신규 실행 플래그를 끄고 이력·공유 객체는 보존한다.

> 아키텍처 전반은 [`./ARCHITECTURE.md`](./ARCHITECTURE.md), 접근 경로는 [`./API.md`](./API.md), 앱 상태는 [`../agent/STATE.md`](../agent/STATE.md)를 본다. 데이터의 출처(프로토타입 목)는 `src/data.js`다. 이 문서는 그 목 데이터를 **타입드 영속 모델**로 정규화한 것이다.
