# 아키텍처

> **정본은 루트의 `README.md`(핸드오프)와 `CLAUDE.md`다.** 이 문서는 그 내용을 통합한 요약이며, 충돌 시 루트 문서를 따른다.
>
> 현재 코드는 **고충실도 디자인 프로토타입**이다(빌드 없음, 브라우저 내 Babel JSX 트랜스파일, `window.*` 목 데이터). 프로덕션은 이 디자인을 실제 스택(번들러, 라우터, 실제 상태/비디오/PDF 파이프라인)으로 재구축한다.
>
> 형제 문서: [`DB.md`](./DB.md) · [`API.md`](./API.md) · [`SEQUENCE_DIAGRAM.md`](./SEQUENCE_DIAGRAM.md) · [`CODING_CONVENTION.md`](./CODING_CONVENTION.md) · [`ENV.md`](./ENV.md). 앱 상태는 [`../agent/STATE.md`](../agent/STATE.md), 결정 근거는 [`../agent/ADR.md`](../agent/ADR.md).

## 프로덕션 스택 (확정)

| 레이어 | 선택 | 근거 |
|---|---|---|
| 프레임워크 | **Next.js 15 (App Router)** | CLAUDE.md 규칙(서버 로직 = route handler)과 정합. 라이브/PDF/초대 서버 로직을 한 스택에서 처리 |
| 언어 | TypeScript strict | CLAUDE.md |
| 스타일 | Tailwind + `styles.css` 토큰 이식 + shadcn/ui | 토큰 기반 라이트/다크([`../design/DESIGN_GUIDE.md`](../design/DESIGN_GUIDE.md)) |
| DB/ORM | **Prisma + SQLite** | 4인 단일 그룹 경량 시작, Postgres 이전 경로 유지 |
| 라이브 | **LiveKit(SFU)** | 다자간 화상 위임(ADR-019, ADR-002 대체) |
| 검증/테스트 | zod · Vitest+RTL(TDD) | API 경계 검증, CLAUDE.md TDD |

> ADR-008은 Vite/React를 *예시*로 들었으나, CLAUDE.md의 "서버 로직은 route handler에서만" 규칙과의 정합성 때문에 **Next.js 15로 확정**한다. 이 변경의 근거는 [`../agent/ADR.md`](../agent/ADR.md) ADR-009 참조.

## 프로덕션 런타임 아키텍처

> 프로토타입은 단일 클라이언트 SPA지만, 프로덕션은 **Vercel(앱) + Supabase(데이터·인증·스토리지·실시간) + 외부 잡 러너 + LiveKit(영상)**가 얽힌다. 결정 근거: [`../agent/ADR.md`](../agent/ADR.md) **ADR-016(배포·ADR-010/012/013/014 개정)** · ADR-015 · ADR-017.

### 배포 토폴로지 (ADR-016)
```
[브라우저] ──HTTP──> [Vercel: Next.js 15]
   │  └─Realtime구독─┐    ├─ RSC 렌더 + route handler/Server Action
   │                 │    └─ Prisma → [Supabase Postgres]  (로컬 dev = SQLite)
   │                 │
   ├──< 푸시 ────[Supabase Realtime]   (live 전이·@멘션 broadcast)
   │
[Inngest durable 잡] ──> [Supabase Storage]  (PDF 본문 준비·Figure 렌더)
        ↑ Job                 └──> [Supabase Postgres]  (결과 검증·최신 실행 저장)
[승인한 PC 연결기] ──claim/result──> [Vercel API + LocalAgentJob DB 큐]
        └──> [로컬 Codex·Claude Code]  (선택 모델 추론; 서버 API 키 없음)
[브라우저] ──WebRTC──> [LiveKit SFU]  (다자간 영상·음성·화면공유 트랙; 채팅·반응은 데이터 채널)
```
- **앱은 Vercel 서버리스.** "상시 Node 서버·SQLite 파일·인-프로세스 워커"를 가정하지 않는다(ADR-016이 ADR-010/012 개정).
- 로컬 개발은 SQLite(Prisma) 유지 — `DATABASE_URL`만 Supabase Postgres로 교체하면 운영.

### 데이터 흐름 — 읽기 vs 쓰기 (ADR-015)
CLAUDE.md "서버 로직은 route handler/서버에서만"을 RSC 시대에 맞게 구체화한다.

| 경로 | 방법 | 비고 |
|---|---|---|
| **읽기(조회)** | 서버 컴포넌트(RSC)에서 `lib/`의 서버 함수로 Prisma 직접 조회 | 클라이언트가 DB를 직접 보지 않음 → 규칙 충족. 초기 페인트 빠름 |
| **쓰기(변이)** | Server Action 또는 route handler(`app/api/**`) | zod 검증·권한·작성자 주입은 여기서. 변이 후 `revalidatePath`/`revalidateTag` |
| **인터랙티브 섬** | 클라이언트 컴포넌트(`"use client"`) | live 룸·관점 토글·스케줄 편집·업로드 모달·명령 팔레트만. 나머지는 RSC |
| **실시간 수신** | Supabase Realtime 구독(아래) | 폴링 대신 푸시 |

> 즉 **읽기는 서버에서 직접, 쓰기는 서버 액션/route handler.** 클라이언트 컴포넌트에서 fetch로 자체 API를 부르는 건 인터랙티브 섬에 한정한다.

### 백그라운드 작업 (ADR-013→016) — CRITICAL
**본문 준비·분석 후처리는 요청 경로에서 인라인으로 돌리지 않는다.** 긴 추론은 승인한 PC의 CLI에서 실행하고, Inngest는 짧은 준비·조회·저장 단계와 durable sleep을 담당한다. 서버리스 요청이나 메모리 Promise를 PC 응답까지 유지하지 않는다([`./ENV.md`](./ENV.md), ADR-026).
```
POST /api/papers → Paper 저장 + 본문 준비 트리거 → 즉시 201(AI 호출 0회)
Inngest → sourceText/sourceDigest 준비 → analysisStatus=awaiting_ai
사용자 PC·모델 선택 → POST /reanalyze → Job(prepare_local_analysis) → 즉시 202
Inngest → LocalAgentJob(paper_analysis) 적재 → 승인한 PC의 CLI가 claim/result
Inngest → durable sleep/짧은 DB 조회 → strict JSON·페이지/인용 검증·Figure 렌더
  → 최신 analysisRequestId CAS → Analysis 두 관점/Figure 저장 → ready|failed
클라이언트는 완료 알림·재조회로 갱신한다 (GET/POST/DELETE /reanalyze)
```
- `Job`은 준비·후처리의 실행 원장이고 `LocalAgentJob`은 PC 실행 큐다. 실행 선택·소유자·팀·세션은 서버에서 고정하며 원문이나 context를 클라이언트 입력으로 받지 않는다([`./DB.md`](./DB.md)).
- **업로드 성공 ≠ 분석 성공**을 아키텍처로 강제한다(분리된 잡).
- Gemini 자동 실행·자동 원격 API 대체는 없다. 현재 CLI는 텍스트 전용이므로 Figure 해석은 본문·캡션 기반 추론이고 외부 저장소는 미검증이다. 논문 상세의 research/repro와 공통 Figure 하단은 유지한다.

### 실시간 동기화 (ADR-014→016) — `live`·알림
`live`는 **모두에게 즉시** 일관돼야 한다(ADR-001). 폴링 대신 **Supabase Realtime**으로 전이를 브로드캐스트한다.
```
팀별 Supabase Realtime 채널 live:{teamId} ── live.started / live.ended ──> 해당 팀 클라
  → 사이드바 LIVE 배지·홈 배너·meeting 룸을 동시에 갱신
```
- broadcast 또는 `postgres_changes`(LiveSession 변화)로 구독. Vercel 서버리스/다중 리전에서도 성립(인-프로세스 버스 가정 금지).
- @멘션·라이브 시작 알림 채널(인앱/이메일/푸시)은 미결 → ISSUES I-5. 인앱(Realtime)은 기본.

### 외부 서비스 경계
- **LiveKit(SFU):** 앱은 입장 토큰 발급·권한 체크·룸 정리만(ADR-019). 영상·음성·화면공유 트랙과 룸 presence는 LiveKit이 담당하고, 채팅·반응·손들기는 LiveKit 데이터 채널로 룸 내부 전송한다. 화면공유 grant는 발표자 토큰에만([`../security/SECURITY.md`](../security/SECURITY.md)). 녹화(Egress)는 미결(ISSUES).
- **Supabase Storage:** PDF/에셋은 **프리사인 업로드**(클라이언트→Storage 직접, 서버는 서명만). 다운로드는 단기 **서명 URL**(비공개 버킷). arXiv는 잡 러너가 가져온다(SSRF 화이트리스트).
- **Supabase Auth:** Google OAuth + 초대 게이트(ADR-017). service role 키는 서버 전용.

### 동시성·멱등성
- **라이브:** 동시 active 1개 — `/start`가 이미 있으면 `409`(ADR-001).
- **스케줄:** 두 관리자가 같은 달을 편집할 수 있다 → `ScheduleMonth`에 **낙관적 락(version)**. 저장 시 버전 불일치면 `409` "다른 사람이 먼저 저장했어요"([`./DB.md`](./DB.md), [`./API.md`](./API.md)).
- **잡:** 워커는 잡을 원자적으로 claim(중복 처리 방지). 재시도는 멱등.

## 디렉토리 구조 (프로토타입, src/)
```
src/
├── index.html                  # 엔트리. React 18 UMD + @babel/standalone 로드, 스크립트 로드 순서가 중요
├── styles.css                  # 모든 스타일 + 디자인 토큰 (:root / [data-theme="dark"])
├── data.js                     # 목 데이터: window.TEAM/PAPERS/SCHEDULE/CURRENT_USER + find* 헬퍼
├── image-slot.js               # figure 플레이스홀더 웹 컴포넌트
├── app.jsx                     # 라우터 + 앱 레벨 상태(live 포함) + 화면 switch — 마지막에 로드/마운트
├── shell.jsx                   # 사이드바 + 상단바
├── screens-auth.jsx            # 로그인/히어로
├── screens-main.jsx            # 대시보드, 라이브러리, 팀, 프로필
├── screens-detail.jsx          # 논문 상세, PresentationView, 업로드 모달
├── analyzer.jsx                # AnalysisView (관점 토글, 섹션, figure, 섹션별 노트)
├── screens-presentations.jsx   # 발표 자료 목록
├── screens-schedule.jsx        # 스케줄 (빈/편집/확정 + 벌금 + 순번 + 통계)
├── meeting.jsx                 # 세미나 라이브 (빈 상태 + 룸)
├── legal.jsx                   # 약관/개인정보
└── tweaks-panel.jsx            # 디자인 탐색 도구 — 프로덕션에 포팅 금지
```

## 패턴
- **ES 모듈 없음, 전역 스코프 공유.** `index.html`의 `<script>` 로드 순서가 의존성을 정의한다: `data.js` → `image-slot.js` → JSX들 → `app.jsx`.
- **파일별 훅 별칭.** 전역 충돌 방지를 위해 각 파일이 고유 이름으로 React 훅을 구조분해한다(`useAppState`/`useAppEffect`, `useDetailState`, `useAnState`, `useMeetState` 등). 파일에 상태를 추가할 때는 기존 별칭 접두사를 따른다.
- **`app.jsx`가 전체 라우터이자 리프트된 상태의 소유자.** `stage`(`auth` → `onboarding` → `app`)가 전체를 게이팅하고, 내부의 `switch (screen)`이 현재 화면을 선택한다. 이 switch가 존재하는 화면과 props의 단일 진실 공급원이다.
- **스타일은 전부 `styles.css`.** 테마/밀도/액센트는 `data-theme` / `data-density` 속성과 `--accent*` oklch 토큰 오버라이드로 적용. 값은 하드코딩하지 말고 토큰에서 가져온다.

## 데이터 흐름
```
프로토타입:
  사용자 인터랙션 → 화면 컴포넌트 → onNavigate(screen, params) / onToast(msg)
                                  → 리프트된 상태 변경 (app.jsx) → 모든 표면에 일관 반영
  데이터 읽기: window.PAPERS / TEAM / SCHEDULE … + find* 헬퍼 (data.js)

프로덕션 (의도):
  읽기: RSC(서버) → Prisma 직접 조회 → HTML 스트리밍
  쓰기: 클라이언트 인터랙티브 섬 → Server Action/route handler → DB/외부 → revalidate
  긴 작업: 요청은 즉시 응답(pending) + 잡 트리거 → 외부 durable 잡 러너 처리 → Realtime/재조회로 반영
  라이브: LiveKit 룸 생성 + 참가자별 입장 토큰 발급 → 같은 룸에서 다자간 화상·화면공유(채팅은 데이터 채널); 전이는 Supabase Realtime로 전 클라 동기화
```
> 상세는 위 §프로덕션 런타임 아키텍처. 클라이언트가 DB·외부 서비스를 직접 보지 않는다는 원칙은 유지하되, 읽기는 RSC 서버 조회, 쓰기는 Server Action/route handler로 구체화한다.

## 상태 관리
- **앱 레벨로 리프트해야 하는 상태** (화면별로 두면 안 됨):
  - `live: boolean` — 사이드바 LIVE 배지, 대시보드 배너, 미팅 룸 vs. 빈 상태를 모두 좌우. `MeetingScreen`이 `onSetLive`로 위로 올린다.
  - `theme`, 사이드바 `collapsed`, `uploadOpen`, 현재 `screen` + params.
- **서버 측에서 모델링할 데이터** (현재는 `data.js`의 `window.*`):
  - `papers` + `analyses` (연구/재구현 구조화 필드, 페이지 참조·해석이 있는 figure)
  - `sectionNotes` — `{paperId, sectionId, lens, author, title, body}`; Figure 노트는 `lens: "any"`
  - `presentations` + `comments` (스레드형, @멘션, 반응)
  - `schedule` — `{year, month}` 키 → weeks `[{week, date, time, presenter, topic, confirmed, status, presId}]` + 순번 포인터
  - `fines` (presenterFine, absentFine) + 멤버별 출석/납부 장부
  - `team` 멤버 + 역할 + 대기 중인 초대
  - `liveSession` (active, presenter, participants)

## 프로토타입 메커니즘 → 프로덕션 교체표
| 프로토타입 | 교체 대상 |
|---|---|
| `@babel/standalone` 브라우저 트랜스파일 | 실제 빌드 (Vite/Next) |
| `data.js`의 `window.*` 전역 | API + 타입드 모델 / DB |
| 파일별 로컬 `useState` 별칭 | 실제 상태 관리 + 서버 영속화 |
| `<image-slot>` 플레이스홀더 | 실제 이미지 업로드 / 렌더링된 PDF figure |
| `getUserMedia` 프리뷰 + 정적 아바타 | **LiveKit(SFU)** — 실제 다자간 참가자 비디오 타일·화면공유 |
| `tweaks-panel.jsx` | **제거** |

## 로컬 CLI 연결 (ADR-025)

`lib/local-agent`와 인증된 `app/api/local-agent`가 페어링·2분 허가·DB 큐를 담당하고 `connector/` 설치앱이 기존 CLI를 실행한다. 웹은 자체 API만 호출한다. 질문은 적재 후 202로 끝나며 연결기가 claim/result를 전송한다. 앱 heartbeat는 웹 허가를 갱신하지 못한다. 서버리스 함수에서 CLI나 지속 WebSocket을 띄우지 않는다. 인증된 짧은 상태 조회로 연결을 동기화하며 기존 live Realtime의 역할은 유지한다. [상세](./LOCAL_AGENT.md).

## 개인 연구 채팅과 결과 수명 (ADR-026)

기존 분석 논문에 원문 캐시가 없으면 `POST /api/research-chat/sources {paperIds}`가 활성 팀·Origin을 확인하고 본문이 없는 1~3개 논문만 Inngest 본문 준비에 적재한다. 202 `{preparing,ready}`로 응답하며 CLI·모델 없이 원문만 준비하고 기존 분석 결과를 보존한다.

별도 작업 공간 `/ai-chat`은 `ResearchConversation`과 `LocalAgentJob(purpose=chat)`을 사용한다. 활성 팀 논문 1~3개를 서버에서 조회해 원문을 구성하고, 작성자 개인 이력을 반환한다. 같은 대화의 행 잠금과 `(conversationId, conversationTurn)` 고유 제약으로 동시 턴을 하나로 제한한다. 현재 명시적으로 선택한 모델을 사용하며 기존 연결·한도 UI를 재사용한다. 부분 답변은 짧은 자체 API 조회로 누적 표시하고 취소·오프라인·세션 오류를 구분한다.

새 로그인은 소유자+활성 팀으로 개인 기록을 읽을 수 있으나 과거 grant로 실행하거나 이전 세션의 작업을 취소하지 못한다. 화면은 최근 50턴·목록 100개이며, 모델에는 완료된 최근 8턴과 원문을 합해 최대 20만 자를 전달하고 생략 여부를 표시한다. 대화 결과는 기존 논문 분석·팀 노트를 자동 변경하지 않는다.

유효 grant 중 서버가 이미 `completed`로 접수한 결과의 검증·렌더·영속은 로그아웃 뒤에도 마친다. 이후 신규/계속 추론과 미접수 결과는 거절하며 Inngest가 웹 허가를 갱신하지 않는다. 최종 분석 저장은 현재 멤버십·팀·최신 실행 CAS를 다시 확인한다. 운영 스키마는 아직 미적용이며 [수동 적용 단계](./DB.md#local-ai-schema)와 추가 전체 품질 검증을 완료해야 한다.

## PT 제작 경로 (ADR-032)

`components/seminar`는 논문 선택·제작 대화·방향·목차·도식 미리보기·파일 상태를 담당한다. 서버 RSC가 활성 팀의 논문과 개인 작업을 읽고, 변이는 `/api/agent/tasks/:id/seminar`와 exports/save를 호출한다. `lib/seminar/contract.ts`는 공유 구조, workflow.ts는 검증된 대화 전이, render.ts는 결정된 HTML/PDF 기하, exports.ts는 소유자·원문·덱 결속과 내구성 출력이다. `worker/seminar-export.ts`는 Inngest 실행·재접수를 제공한다. 요청 경로에는 모델 추론·덱 렌더를 넣지 않는다.

모델은 실제 읽은 원문과 Figure 메타데이터로 구조화 JSON만 제안한다. 화면 그림 확인을 했다고 주장하지 않는다. 실제 원문 자산 다운로드·페이지 렌더·이미지 정규화·자체 포함 HTML과 한글 PDF 생성은 정해진 서버 코드가 수행한다. 저장한 PDF는 기존 발표 자료/라이브 공유 경계를 재사용한다. 새 CLI 도구·별도 범용 에이전트·외부 유료 모델 자동 대체는 추가하지 않는다.

## 목표 작업 경로 (ADR-031)

`/presentations → /ai-chat?work=seminar` 또는 논문이 첨부된 AI 채팅 → `/api/agent/tasks` → `AgentTask` → Inngest `worker/agent-task.ts` → `lib/agent/service.ts`의 짧은 상태 전이 → `LocalAgentJob(purpose=agent_step)` → PC 브릿지의 구조화된 텍스트 추론 → 서버 읽기/초안 검증 순서다. 요청 경로는 추론을 기다리지 않는다.

별도 검토 API는 `lib/section-notes.ts` 또는 `lib/presentation-writes.ts`의 기존 UI 공통 쓰기를 사용한다. 권한·원문·버전 검사와 원장을 같은 트랜잭션으로 묶고 커밋 후 DB 재조회로 검증한다. 클라이언트는 private DTO·검토 편집만 담당한다.

> **정본은 루트의 `README.md`(핸드오프)와 `AGENTS.md`다.** 이 문서는 그 내용을 통합한 요약이며, 충돌 시 루트 문서를 따른다.
>
> 현재 코드는 **고충실도 디자인 프로토타입**이다(빌드 없음, 브라우저 내 Babel JSX 트랜스파일, `window.*` 목 데이터). 프로덕션은 이 디자인을 실제 스택(번들러, 라우터, 실제 상태/비디오/PDF 파이프라인)으로 재구축한다.
>
> 형제 문서: [`DB.md`](./DB.md) · [`API.md`](./API.md) · [`SEQUENCE_DIAGRAM.md`](./SEQUENCE_DIAGRAM.md) · [`CODING_CONVENTION.md`](./CODING_CONVENTION.md) · [`ENV.md`](./ENV.md). 앱 상태는 [`../agent/STATE.md`](../agent/STATE.md), 결정 근거는 [`../agent/ADR.md`](../agent/ADR.md).
