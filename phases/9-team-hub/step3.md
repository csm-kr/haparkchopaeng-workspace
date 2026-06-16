# Step 3: team-hub-e2e

진입 팀 허브 플로우를 Playwright 헤드리스 E2E로 검증한다: **로그인 → `/teams` 허브 → 팀 선택 → `/dashboard`**. 기존 진입 E2E를 새 목적지(`/teams`)에 맞게 갱신한다. **비파괴**(공유 운영 Supabase) 원칙을 지킨다.

## 읽어야 할 파일

먼저 아래를 읽고 설계 의도를 파악하라. **정본은 루트 `README.md` · `CLAUDE.md` · `PRD.md`이며, 충돌 시 이를 따른다.**

항상:
- `docs/dev/ARCHITECTURE.md` · `docs/agent/ADR.md`(**ADR-021** 진입 팀 허브) · `docs/dev/CODING_CONVENTION.md`

화면/플로우 레이어:
- `docs/user/USER_FLOW.md` — 핵심 진입 경로
- `docs/design/SCREENS.md` — 팀 허브 화면 명세(step 0)

기존 E2E 관행(꼭 읽고 패턴을 따라라):
- `tests/e2e/entry.spec.ts` — 진입 흐름 E2E(이걸 갱신한다). dev 로그인(`POST /api/auth/login`, `de8167@gmail.com` = 단일 owner), `next` 복귀 검증 패턴
- `tests/e2e/team.spec.ts` · `tests/e2e/team-scoping.spec.ts` — **데이터 가변 시 `test.skip` graceful skip** 패턴(공유 DB 비파괴)
- `playwright.config.*` — webServer가 `next dev`를 기동(prod 빌드는 login 404 — dev 전제)

step 1~2 산출물(읽고 이어간다):
- `app/teams/page.tsx` · `team-picker.tsx` · `create-team-form.tsx` — 허브 화면
- `app/auth/callback/route.ts` · `app/page.tsx` · `app/(app)/layout.tsx` — `/teams` 착지로 전환됨

## 작업

### 1. `tests/e2e/entry.spec.ts` 갱신
- 기존 "팀 보유 멤버는 `/teams/new`로 튕기지 않는다" 테스트를 **새 진입 모델**에 맞게 고친다:
  - dev 로그인 후 `/dashboard` **직접 방문**은 활성 팀 쿠키가 있으면 그대로 `/dashboard`에 머문다(허브는 "로그인 직후 착지"에만 강제 — 직접 방문/북마크은 가드만 통과하면 됨). → URL이 `/teams`로 튕기지 **않음**을 단언. (주석의 `/teams/new` 언급도 `/teams`로 정정.)
- `next` 복귀(초대) 테스트는 **그대로 유지**(로그인 후 `next`가 있으면 `/teams`가 아니라 `next`로 가야 한다 — 이 불변을 단언으로 확인).
- 알 수 없는 초대 토큰 not_found 카드 테스트는 무관 — 유지.

### 2. 팀 허브 핵심 경로 E2E 추가(`tests/e2e/entry.spec.ts`에 추가 또는 `tests/e2e/team-hub.spec.ts` 신설)
- **허브 노출 + 선택 진입**: dev 로그인(`de8167@gmail.com`) → `page.goto("/teams")` → 허브에 내 팀이 보인다 → 팀 선택(클릭) → `/dashboard`로 이동(URL 단언). (단일 owner 계정이라 최소 1팀 존재 — 선택 대상 보장.)
- **로그인 직후 착지**: `next` 없는 로그인 흐름이 `/teams`로 착지하는지 확인. dev 로그인 라우트가 어디로 보내는지에 따라:
  - `AuthScreen`/`/api/auth/login` 흐름이 `/teams`로 보내면 그 URL을 단언.
  - 만약 dev 로그인 라우트가 자체 목적지를 갖는다면, **`page.goto("/teams")`로 허브 도달 + 팀 선택→대시보드**만 단언하고 "로그인 직후 자동 착지"는 `app/page.tsx`/`auth/callback` 단언 범위 밖으로 두라(헤드리스에서 OAuth 왕복은 불가 — 주석으로 근거 남길 것).
- **생성 상한 가시화(선택적·graceful)**: 전역 상한 도달 여부는 공유 DB 상태에 따라 가변이므로:
  - 만들기 영역이 **활성**이면 "팀 이름" 입력이 보이는지만 단언(실제 제출 금지 — 파괴적).
  - **비활성**(상한 도달)이면 "최대 팀 수에 도달했어요" 안내가 보이는지 단언.
  - 둘 중 어느 쪽도 단정할 수 없으면 `test.skip`(데이터 가변) — 기존 graceful skip 패턴.

> **CRITICAL(비파괴): 팀을 실제로 생성하지 마라.** 이유: 공유 운영 Supabase에 Team/Membership 행이 생긴다(되돌리기 어려움). 만들기 폼은 **노출·활성/비활성 상태까지만** 검증하고 제출 버튼을 누르지 않는다.

> **활성 팀 선택은 비파괴다**(쿠키만 바뀜) — 선택→대시보드 이동은 실제로 눌러 검증해도 된다.

### 3. 단위 레이어로 미루지 말 것 / E2E 범위
- 컴포넌트 단위(목 기반)는 step 1의 RTL이 담당한다 — E2E로 중복하지 마라.
- E2E는 `USER_FLOW.md`의 핵심 경로(로그인 모델 → 허브 → 선택 → 앱)만 검증한다.

## Acceptance Criteria

```bash
npm run build
npx playwright test       # 헤드리스 — 진입 허브 핵심 경로
```

> webServer는 `next dev` 기동 전제(기존 e2e 관행). 공유 DB라 데이터 가변 spec은 `test.skip`로 graceful하게.

## 검증 절차

1. AC 실행.
2. 체크리스트:
   - 로그인 → 허브(`/teams`) → 팀 선택 → `/dashboard` 경로가 통과하는가?
   - `next`(초대) 복귀가 `/teams`보다 우선임을 단언했는가?
   - **팀을 실제로 생성하지 않았는가?**(비파괴) 활성 팀 선택만 실제 수행.
   - `/teams/new`를 가리키는 단언이 남아 있지 않은가?
   - 데이터 가변 케이스에 graceful `test.skip`를 썼는가?
3. `phases/9-team-hub/index.json`의 step 3 업데이트(`completed`+`summary` / `error`).

## 금지사항

- **E2E에서 팀을 실제로 생성하지 마라(만들기 제출 금지).** 이유: 공유 운영 DB에 되돌리기 어려운 행이 생긴다 — 노출/상태 검증까지만.
- **Selenium을 쓰지 마라 — Playwright 헤드리스만.** 이유: execute.py 비대화형 실행과 자동 대기·정합(프로젝트 e2e 표준).
- **단위/컴포넌트 검증을 E2E로 재구현하지 마라.** 이유: 그 레이어는 step 1의 Vitest+RTL 소관.
- **prod 빌드로 e2e를 돌린다고 가정하지 마라.** 이유: dev 로그인은 prod에서 404(`playwright.config`가 `next dev` 기동).
- 기존 통과 테스트(`team.spec.ts`·`team-scoping.spec.ts` 등)를 깨뜨리지 마라.
