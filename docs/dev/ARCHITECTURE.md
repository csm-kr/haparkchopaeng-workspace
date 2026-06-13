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
| 라이브 | **Cloudflare Stream Live** (MVP 포함) | 영상 인프라 위임(ADR-002) |
| 검증/테스트 | zod · Vitest+RTL(TDD) | API 경계 검증, CLAUDE.md TDD |

> ADR-008은 Vite/React를 *예시*로 들었으나, CLAUDE.md의 "서버 로직은 route handler에서만" 규칙과의 정합성 때문에 **Next.js 15로 확정**한다. 이 변경의 근거는 [`../agent/ADR.md`](../agent/ADR.md) ADR-009 참조.

## 프로덕션 런타임 아키텍처

> 프로토타입은 단일 클라이언트 SPA지만, 프로덕션은 **상시 구동 서버 + 백그라운드 워커 + 외부 서비스**가 얽힌다. 아래는 그 토폴로지와 경계다. 결정 근거: [`../agent/ADR.md`](../agent/ADR.md) ADR-012~015.

### 배포 토폴로지 (ADR-012)
```
[브라우저] ──HTTP/SSE──> [Next.js 상시 서버 (Node, 서버리스 아님)]
                              │  ├─ RSC 렌더 + route handler/Server Action
                              │  ├─ 인-프로세스 워커(잡 폴링)  ← MVP
                              │  └─ Prisma → [SQLite 파일]
                              ├──> [Cloudflare Stream Live]  (Live Input·HLS·녹화)
                              ├──> [객체 스토리지]  (PDF·에셋·figure, 서명 URL)
                              └──> [Anthropic API]  (분석, 워커에서만)
```
- **CRITICAL: 서버리스 함수가 아니라 상시 구동 Node 서버.** 이유: ① 분 단위 분석/녹화 후처리를 인-프로세스 워커로 돌려야 하고 ② SQLite 파일은 영속 디스크가 필요하다. 서버리스는 둘 다 깨진다.
- 4인 단일 인스턴스 가정. 수평 확장은 비범위(Postgres+외부 큐로 이전 시 재검토 → [`../agent/ISSUES.md`](../agent/ISSUES.md)).

### 데이터 흐름 — 읽기 vs 쓰기 (ADR-015)
CLAUDE.md "서버 로직은 route handler/서버에서만"을 RSC 시대에 맞게 구체화한다.

| 경로 | 방법 | 비고 |
|---|---|---|
| **읽기(조회)** | 서버 컴포넌트(RSC)에서 `lib/`의 서버 함수로 Prisma 직접 조회 | 클라이언트가 DB를 직접 보지 않음 → 규칙 충족. 초기 페인트 빠름 |
| **쓰기(변이)** | Server Action 또는 route handler(`app/api/**`) | zod 검증·권한·작성자 주입은 여기서. 변이 후 `revalidatePath`/`revalidateTag` |
| **인터랙티브 섬** | 클라이언트 컴포넌트(`"use client"`) | live 룸·관점 토글·스케줄 편집·업로드 모달·명령 팔레트만. 나머지는 RSC |
| **실시간 수신** | SSE 구독(아래) | 폴링 대신 푸시 |

> 즉 **읽기는 서버에서 직접, 쓰기는 서버 액션/route handler.** 클라이언트 컴포넌트에서 fetch로 자체 API를 부르는 건 인터랙티브 섬에 한정한다.

### 백그라운드 작업 (ADR-013) — CRITICAL
**분석·arXiv 가져오기·녹화 후처리는 요청 경로에서 인라인으로 돌리지 않는다.** 이유: Claude 분석은 분 단위라 HTTP 타임아웃을 넘는다([`./ENV.md`](./ENV.md)).
```
POST /api/papers → Paper 저장(analysisStatus=pending) + Job 적재 → 즉시 201 응답
                                              │
인-프로세스 워커 폴링 ──> Anthropic 분석 ──> Analysis/Figure 저장, analysisStatus=ready|failed
클라이언트는 SSE 또는 재조회로 ready 전환을 받는다 (/reanalyze로 재시도)
```
- 잡은 DB `Job` 테이블 + 인-프로세스 폴링 워커로 시작(외부 큐 불필요, [`./DB.md`](./DB.md)). 멱등·재시도·실패 보존.
- **업로드 성공 ≠ 분석 성공**을 아키텍처로 강제한다(분리된 잡).

### 실시간 동기화 (ADR-014) — `live`·알림
`live`는 **모두에게 즉시** 일관돼야 한다(ADR-001). 폴링 대신 **SSE 푸시**로 전이를 브로드캐스트한다.
```
GET /api/live/stream (SSE) ── live.started / live.ended / mention 이벤트 ──> 모든 클라
  → 사이드바 LIVE 배지·홈 배너·meeting 룸을 동시에 갱신
```
- 단일 인스턴스라 인-프로세스 이벤트 버스로 충분. 다중 인스턴스로 가면 Redis pub/sub 등 필요(비범위).
- @멘션·라이브 시작 알림 채널(인앱/이메일/푸시)은 미결 → ISSUES I-5. 인앱(SSE)은 기본으로 둔다.

### 외부 서비스 경계
- **Cloudflare Stream Live:** 앱은 Live Input 생성·권한 체크·플레이어 노출만(ADR-002). **녹화 완료는 Cloudflare 웹훅**으로 수신 → 발표 자료 아카이브 여부 결정(미결 I-3). 송출 자격증명은 발표자에게만([`../security/SECURITY.md`](../security/SECURITY.md)).
- **객체 스토리지:** PDF/에셋은 **프리사인 업로드**(클라이언트→스토리지 직접, 서버는 서명만)로 큰 파일이 서버를 거치지 않게 한다. 다운로드는 단기 **서명 URL**. arXiv는 서버(워커)가 가져온다(SSRF 화이트리스트).

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
  긴 작업: 요청은 즉시 응답(pending) + 잡 적재 → 워커 처리 → SSE/재조회로 반영
  라이브: Live Input 생성 → 발표자 RTMPS/SRT 송출 → 시청자 HLS/Player; 전이는 SSE로 전 클라 동기화
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
| `getUserMedia` 프리뷰 + 정적 아바타 | Cloudflare Stream Live |
| `tweaks-panel.jsx` | **제거** |
