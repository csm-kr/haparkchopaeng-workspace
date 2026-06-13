# Step 7: dashboard

홈(대시보드) 화면을 만든다: **`live`일 때만 뜨는 LIVE 배너**, 퀵 카드(논문·발표 자료 개수), 최근 활동(최근 논문·발표 자료). 읽기는 RSC 서버 조회. 첫 E2E(Playwright)를 가동한다.

## 읽어야 할 파일

먼저 아래 문서를 읽고 설계 의도를 파악하라. **정본은 루트 `README.md` · `CLAUDE.md` · `PRD.md`이며, 충돌 시 이를 따른다.**

항상:
- `docs/dev/ARCHITECTURE.md` — §데이터 흐름(읽기=RSC 서버 조회), Vercel+Supabase 토폴로지
- `docs/agent/ADR.md` — **ADR-001(`live` 앱 레벨)·ADR-015(RSC/쓰기 경계)·ADR-016(배포)**. 고치지 말 것.
- `docs/dev/CODING_CONVENTION.md`

이 step(화면/UI):
- `docs/design/SCREENS.md` — §dashboard(LIVE 배너·퀵 카드·최근 활동) + §화면별 상태(빈/로딩/에러)
- `docs/design/SCREEN_FLOW.md` — 내비게이션 맵·`live`가 좌우하는 표면
- `docs/user/USER_FLOW.md` — 핵심 경로(홈→입장 ≤2클릭)
- `docs/design/DESIGN_GUIDE.md` — 토큰·컴포넌트·§UX 패턴(상태 3종·접근성·모션)
- `docs/agent/STATE.md` — `live` 앱 레벨, 파생값
- `docs/agent/RULES.md` — R5·R20·R21·R26·R29·R32

이전 step 산출물(재사용):
- `components/shell/*`·`components/providers/*`(`useLive`)·`components/ui/*` — 셸·live 컨텍스트·UI
- `app/(app)/layout.tsx`·`app/(app)/dashboard/page.tsx`(자리표시 → 실제 내용으로)
- `lib/prisma.ts`·`lib/auth.ts` — 서버 조회·세션
- `app/api/auth/login/route.ts` — dev 이메일 로그인(E2E 로그인에 사용)
- `playwright.config.ts` — E2E 설정(없으면 보강)

## 작업

### 1. 대시보드 화면 — `app/(app)/dashboard/page.tsx` (RSC)
- **읽기는 서버에서 직접**(`lib/`의 서버 함수로 Prisma 조회): 논문 개수·발표 자료 개수·최근 논문 N·최근 발표 자료 N(ADR-015). 클라이언트 fetch 금지.
- 구성(SCREENS §dashboard):
  - **LIVE 배너**: 최상단, **`live===true`일 때만** 렌더(`useLive`). 클릭 → meeting. `live===false`면 숨김(R5/ADR-001).
  - **퀵 카드** 행: `{icon,label,count,desc}`(논문·발표 자료 등) — `Card` 사용, 토큰만.
  - **최근 활동**: 최근 논문·발표 자료 목록(클릭 → 해당 상세 라우트로 이동; 상세 화면은 이후 step이라 링크만).
- 상태 3종: 데이터 로딩은 `Skeleton`, 신규/빈은 `EmptyState`("첫 논문을 올려볼까요?"), 조회 실패는 에러 카드(R26).
- LIVE 배너는 인터랙티브(클라이언트), 데이터 카드/목록은 RSC.

### 2. E2E — Playwright
- `playwright.config.ts`: 헤드리스, `webServer`로 앱 자동 기동(`next dev` 또는 `next build && next start`), `baseURL`.
- `tests/e2e/dashboard.spec.ts`(핵심 경로 1개):
  1. dev 로그인(`POST /api/auth/login`에 시드 멤버 이메일 — 예: 하수현)으로 세션 확보
  2. `/dashboard` 진입 → 셸(사이드바 내비)·퀵 카드 렌더 확인
  3. **`live===false` 기본**이므로 LIVE 배너가 보이지 않음을 확인
- **E2E는 이 핵심 경로만.** 단위/컴포넌트 검증은 Vitest+RTL(예: LIVE 배너가 live=true 컨텍스트에서만 렌더).

## Acceptance Criteria

```bash
npm run build            # 타입/컴파일 에러 없음
npm test                 # vitest run — RTL: 퀵 카드 렌더, LIVE 배너 live 컨텍스트 의존, 빈 상태
npm run lint
npx playwright test      # 헤드리스 E2E: 로그인→대시보드 렌더, live=false면 배너 없음
```
> Playwright 브라우저(chromium)는 이미 설치돼 있다. E2E는 `webServer`로 앱을 자동 기동해 헤드리스로 통과해야 한다. dev 로그인은 시드 DB(`dev.db`)를 사용한다.

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 아키텍처 체크리스트:
   - **LIVE 배너가 `live===true`일 때만** 뜨는가? `live`를 화면에 보관하지 않았는가(ADR-001/R5)?
   - 데이터 읽기가 RSC 서버 조회인가(클라이언트 fetch 아님, ADR-015)?
   - 빈/로딩/에러 3종이 있는가(R26)? 토큰만 썼는가(R20)?
   - E2E가 핵심 경로만 검증하는가(컴포넌트 검증은 RTL)?
3. 결과에 따라 `phases/0-mvp/index.json`의 step7을 업데이트:
   - 성공 → `"completed"` + `"summary"`
   - 3회 실패 → `"error"` + `"error_message"`
   - 사용자 개입 필요 → `"blocked"` + `"blocked_reason"` 후 중단

## 금지사항

- **화면에 `live` 상태를 보관하지 마라.** 앱 레벨 `useLive` 단일 소스(ADR-001/R5).
- **클라이언트 컴포넌트에서 DB를 직접 조회하거나 자체 API를 fetch하지 마라.** 읽기는 RSC 서버 조회(ADR-015/R32).
- **다른 화면(논문 상세·스케줄 보드·라이브 룸 등)의 실제 내용을 만들지 마라.** 최근 활동은 링크만. 실제 상세는 이후 step.
- **E2E로 단위/컴포넌트까지 검증하지 마라.** 핵심 경로만(harness 규칙). 나머지는 Vitest+RTL.
- **hex 하드코딩 금지**(R20). 깜빡임·색만으로 LIVE 전달 금지(R29).
- **`test`를 워치 모드로 두지 마라**(`vitest run`). **E2E를 헤드리스 아닌 모드로 두지 마라**(webServer 자동 기동).
- 기존 테스트를 깨뜨리지 마라.
