# 불변 규칙 (Rules)

> 에이전트(및 사람)가 코드를 짜거나 고칠 때 **절대 어기면 안 되는 규칙** 모음이다. 각 규칙은 근거 ADR/문서로 링크된다. CLAUDE.md의 CRITICAL이 최상위 권위. **이 결정들은 의도적이다 — 코드를 보고 "고치지" 말 것.**

## 아키텍처 / 서버

- **R1. 모든 서버·외부 로직은 route handler/Server Action(`app/api/**`)에서만.** 클라이언트 컴포넌트에서 DB·LiveKit·스토리지·LLM 직접 호출 금지. (CLAUDE.md, [`../dev/CODING_CONVENTION.md`](../dev/CODING_CONVENTION.md))
- **R2. 비밀은 `.env`(서버)에서만.** `NEXT_PUBLIC_*`에 키 금지, 클라이언트 번들 노출 금지. ([`../dev/ENV.md`](../dev/ENV.md), [`../security/SECURITY.md`](../security/SECURITY.md))
- **R3. 작성자/소유자 ID는 세션에서 취한다.** 클라가 보낸 `authorId` 등 미신뢰. ([`../security/SECURITY.md`](../security/SECURITY.md))
- **R4. 스택은 Next.js 15 + TS strict + Tailwind + Prisma/SQLite.** 벗어나지 않는다. (ADR-009/010)

## 런타임 아키텍처

- **R31. 긴 작업을 요청 경로에서 인라인으로 돌리지 마라.** 논문 본문 준비·분석 후처리는 Inngest, 로컬 AI 추론은 승인한 PC의 연결기에서 실행한다. API는 잡 적재 후 즉시 응답하고 대기는 durable sleep과 짧은 DB 조회로 처리한다. 요청·메모리 Promise를 추론 완료까지 붙잡지 않는다. `Job` 모델·"업로드≠분석" 원칙 유지. (ADR-013→016→026, [`../dev/ARCHITECTURE.md`](../dev/ARCHITECTURE.md))
- **R32. 읽기는 RSC 서버 조회, 쓰기는 Server Action/route handler.** 클라이언트 컴포넌트에서 fetch로 자체 API를 부르는 건 인터랙티브 섬에 한정. 클라이언트가 DB·외부 서비스를 직접 보지 않는다. (ADR-015)
- **R33. `live` 전이는 Supabase Realtime으로 푸시한다.** 클라이언트 폴링 금지 — Realtime 구독으로 배지·배너·룸을 동시 갱신(인-프로세스 SSE 버스 가정 금지). (ADR-014→016)
- **R34. 배포는 Vercel 서버리스 + Supabase다.** "상시 Node 서버·SQLite 파일·인-프로세스 워커"를 가정하지 마라. DB=Supabase Postgres(로컬은 SQLite), 스토리지=Supabase Storage, 실시간=Supabase Realtime, 잡=외부 러너. (ADR-016)
- **R35. 스케줄 저장은 낙관적 락으로 동시 편집을 막는다.** `ScheduleMonth.version` 불일치 시 `409`. (ADR-006, [`../dev/DB.md`](../dev/DB.md))
- **R36. 대용량 업로드는 프리사인 직접 업로드.** PDF는 클라이언트→스토리지 직접, 서버는 서명만. 다운로드는 서명 URL. ([`../dev/API.md`](../dev/API.md), [`../security/SECURITY.md`](../security/SECURITY.md))

## 라이브 (`live`)

- **R5. `live`는 앱 레벨 상태다.** 화면 컴포넌트 안에 `live`를 보관하지 마라. 이유: 사이드바 배지·홈 배너·룸이 어긋난다. (ADR-001, [`./STATE.md`](./STATE.md))
- **R6. 동시 active 라이브 세션은 1개.** `/start`가 이미 active면 `409`. `/end`만 전역 종료, `/leave`는 본인만. (ADR-001, [`../dev/API.md`](../dev/API.md))
- **R7. LiveKit 토큰은 참가자별 서버 발급 · 본인에게만.** 모든 참가자는 자기 카메라/마이크를 publish할 수 있으나 **화면공유 grant는 발표자 토큰에만** 넣는다. 신원(identity)은 세션에서 주입(R3) — 클라가 보낸 식별자 미신뢰. (ADR-019, [`../security/SECURITY.md`](../security/SECURITY.md))
- **R8. 영상 인프라를 직접 만들지 마라.** 다자간 화상은 **LiveKit(SFU)**에 위임. (ADR-019, ADR-002 대체)

## 논문 분석

- **R9. 논문 상세에 탭/사이드패널을 추가하지 마라.** 두 관점 토글 자체가 페이지다. AI 요약/팀 노트 탭 금지. (ADR-004)
- **R10. 두 관점은 research/repro 둘뿐.** Figure 분석은 두 관점 공통(`lens:any`)으로 하단 고정. (ADR-004)
- **R11. 노트는 섹션별 + 작성자 표기.** `{sectionId, lens}` 스코프. figure 노트는 `lens:any`. (ADR-005)
- **R12. 업로드는 PDF 전용.** PPTX/MD·빈 노트/아이디어 메모 단축 금지. Content-Type 외 `415`. `Paper`에 타입/형식 필드 두지 마라. (ADR-003)
- **R13. 원문 PDF 헤더 액션은 다운로드 하나.** arXiv/공유 버튼 추가 금지. (PRD §6)
- **R14. LLM 분석은 보조다.** 사람이 섹션 노트로 검수·보강한다. 업로드만으로 AI를 호출하지 않으며, 명시적으로 선택한 로컬 모델이 초안을 만든다. 연구 채팅은 별도 `/ai-chat`이고 기존 논문 관점·노트에 자동 반영하지 않는다. (ADR-011→026)

## 스케줄

- **R15. 스케줄을 자동 생성하지 마라.** 월 row 부재 = 빈 달. GET이 월을 만들지 않는다. 월 이동 시 자동 채움 금지. (ADR-006, [`../dev/DB.md`](../dev/DB.md))
- **R16. 편집 vs 확정 모드를 분리하라.** 저장 시에만 영속화 + 순번 포인터 전진(서버 원자적). 편집 중 월 이동 잠금. (ADR-006)
- **R17. 논문 목록 필터는 "전체" 하나만.** 타입 필터 추가 금지. (PRD §6)

## 팀 / 인증

- **R18. 팀 합류는 초대 토큰으로만.** 공개 가입(자동 팀 배정) 금지. 로그인은 누구나 가능(처음엔 팀 없음)하되, 팀 진입은 **팀 생성** 또는 **초대 토큰 수락**으로만. 팀 역할 `owner`/`admin`/`member`(`owner`는 초대 불가 · 팀당 ≥ 1). 전역 팀 상한은 `AppSetting.maxTeams` > env `MAX_TEAMS` > 기본 2 순으로 정해지며 `/admin`에서 조절한다(ADR-024). 기존 단일 워크스페이스 기능의 `Member.role`(관리자/멤버/게스트) 권한은 팀 스코핑 전까지 유지. (ADR-007→018, ADR-016)
- **R19. 권한 체크는 서버 진입부에서.** UI 숨김은 보조. 부족 시 `403`. ([`../security/SECURITY.md`](../security/SECURITY.md))
- **R37. 모든 도메인 조회·변이는 활성 팀으로 스코핑한다.** 논문·발표자료·스케줄·벌금·라이브는 활성 팀(쿠키, **검증된 멤버십**)으로 필터하고, 쓰기 `teamId`는 세션의 활성 팀에서 주입한다(클라 미신뢰). 다른 팀 엔티티 접근은 `403`. (ADR-020, R19)

## 디자인

- **R20. 색·반경·그림자·간격은 토큰만.** hex 하드코딩 금지 — 다크/액센트 스위칭이 깨진다. 라이트/다크는 `[data-theme]` 오버라이드만으로. ([`../design/DESIGN_GUIDE.md`](../design/DESIGN_GUIDE.md))
- **R21. 정직한 빈 상태.** 라이브 없음·빈 달은 비운 채로 + 명확한 CTA 하나. 가짜 데이터 금지.
- **R22. `tweaks-panel.jsx`를 포팅하지 마라.** 디자인 탐색 도구이지 제품 기능이 아니다. (ADR-008)

## UX (상태·피드백·접근성)

- **R26. 데이터 화면은 상태 3종을 모두 제공한다.** 로딩(스켈레톤)·빈·에러(다시 시도). 빈 상태만 만들고 로딩·에러를 빠뜨리지 마라. ([`../design/DESIGN_GUIDE.md`](../design/DESIGN_GUIDE.md) §UX 패턴)
- **R27. 파괴적/비가역 액션은 확인하거나 되돌리기를 제공한다.** 라이브 종료·멤버 내보내기·삭제·편집 취소. 종료(전체)와 나가기(본인)를 시각적으로 분명히 구분. ([`../design/SCREENS.md`](../design/SCREENS.md))
- **R28. 업로드 성공과 분석 성공을 분리한다.** 분석 실패가 논문 생성·원문 PDF를 막지 않는다. 분석만 재시도 가능 상태로. ([`../dev/ENV.md`](../dev/ENV.md), [`../design/SCREEN_FLOW.md`](../design/SCREEN_FLOW.md))
- **R29. 깜빡임만으로 정보를 전달하지 마라.** LIVE는 색+텍스트 병행, `prefers-reduced-motion`에서 `livepulse`/`shimmer`를 정적 표현으로 대체. 색에만 의존 금지. ([`../design/DESIGN_GUIDE.md`](../design/DESIGN_GUIDE.md) §접근성)
- **R30. 검증은 인라인, 시스템 에러는 사람 말로.** 빈 노트/잘못된 URL은 입력 옆 인라인 메시지. "Error 500" 같은 원문 노출 금지 — 따뜻한 한국어로 번역.

## 프로세스

- **R23. TDD.** 새 기능은 테스트 먼저, 통과 구현. (CLAUDE.md)
- **R24. Conventional Commits** (`feat:`/`fix:`/`docs:`/`refactor:`). (CLAUDE.md)
- **R25. 🔴 미결(ISSUES)은 구현 전에 결정.** harness step에서 막히면 blocked 처리. ([`./ISSUES.md`](./ISSUES.md))

## 로컬 AI 연결 (ADR-025)

- **R38. 로컬 실행은 웹 세션·팀·승인 기기의 짧은 허가로만.** 앱 heartbeat로 연장하지 않는다. 로그아웃·팀 변경·멤버 제거·만료 이후 claim/result를 거부하고 실행 중 CLI를 취소한다. 인증 파일·임의 로컬 경로는 서버로 전송하지 않는다.
- **R39. 모델·한도·설치 상태를 추정하지 않는다.** 실제 CLI 모델을 직접 선택한다. 한도 기간·비율·관측 시각은 출처대로 표시하고 미확인·오래된 값·0%를 구분한다. 타임아웃으로 미설치를 단정하거나 가짜 설치 파일을 제공하지 않는다.

## 로컬 논문 분석·개인 연구 대화 (ADR-026)

- **R40. 업로드 준비와 AI 실행을 분리한다.** 업로드는 원문 텍스트 준비만 하며 AI 호출은 0회다. 사용자의 PC·제공자·실제 모델 선택 후에만 추론한다. Gemini나 다른 CLI·원격 유료 API로 자동 전환하지 않는다.
- **R41. 원문과 구조화 결과를 검증한다.** 페이지 순서가 있는 PDF 원문(최대 30쪽·본문 12만 자)을 서버에서 준비한다. 분석 JSON·페이지·인용을 검사하고 `Paper.analysisRequestId`가 현재 실행과 같은 경우에만 두 관점 결과를 저장한다. 텍스트 전용 CLI의 Figure는 본문·캡션 기반 추론이고 외부 저장소는 미검증임을 표시한다.
- **R42. 연구 대화는 활성 팀·소유자에게만 보인다.** 대화의 논문 1~3개와 이전 완료 대화는 서버에서 읽는다. 클라이언트의 임의 context·팀·소유자를 받지 않는다. 같은 대화는 한 턴만 진행하며 요청 번호 재전송은 멱등이다. 화면은 최근 50턴·목록 100개, 모델 문맥은 완료된 최근 8턴·최대 20만 자로 제한하고 생략을 알린다.
- **R43. 이력 읽기와 실행 허가를 구분한다.** 새 로그인에서 개인 이력을 읽어도 과거 grant를 되살리지 않는다. R38의 유효 허가 중 서버에 이미 `completed`로 접수된 결과는 로그아웃 후 후처리·영속을 허용한다. 이후 신규/계속 추론과 미접수 결과는 거절한다. 분석 최종 저장 시 현재 멤버십도 재검증한다.
