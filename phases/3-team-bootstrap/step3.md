# Step 3: setup-ui-logout

## 읽어야 할 파일

먼저 아래를 읽고 설계 의도를 파악하라. **정본은 루트 `README.md` · `CLAUDE.md` · `PRD.md`이며, 충돌 시 이를 따른다.**

항상:
- `docs/dev/ARCHITECTURE.md`
- `docs/agent/ADR.md` — **ADR-015**(인터랙티브 섬) · **ADR-007/017/018**
- `docs/dev/CODING_CONVENTION.md`

화면/UI/보안:
- `docs/design/DESIGN_GUIDE.md` · `docs/design/SCREENS.md` · `docs/design/SCREEN_FLOW.md`
- `docs/user/USER_FLOW.md`(F7) · `docs/user/USER_JOURNEY.md`(첫인상/온보딩 톤)
- `docs/security/SECURITY.md`

기존 코드(패턴·재사용):
- `app/page.tsx` — 진입/리디렉트 가드 패턴(`getSession`)
- `components/auth/auth-screen.tsx` — 인증 화면 톤/레이아웃 참고
- `components/settings/settings-view.tsx` — **본 step에서 로그아웃 버튼 추가**(인터랙티브 섬, fetch + 인라인 에러 패턴이 이미 있다)
- `components/ui`(Button/Card/Input) · `lib/utils`(`cn`)
- `lib/auth.ts`(`getSession`) · `lib/workspace.ts`(`getWorkspace`, step 1) · `lib/supabase/server.ts`(`getUser`)
- `components/settings/__tests__/` · `components/team/__tests__/` — RTL 테스트 패턴
- step 0 문서, step 2 `app/api/workspace/route.ts`(클라가 호출할 엔드포인트) · 콜백의 `/setup` 라우팅

이전 step에서 만들어진 `app/api/workspace/route.ts`와 `lib/workspace.ts`를 읽고 작업하라.

## 작업

팀 만들기 화면 + 설정 로그아웃 버튼. **TDD: 컴포넌트 테스트(RTL)를 먼저 작성한다.**

`app/setup/page.tsx` (신규, RSC):
- 가드(순서대로):
  - `getSession()`이 있으면 `redirect("/dashboard")`(이미 합류함).
  - `getWorkspace()`가 존재하면 `redirect("/")`. **CRITICAL: 이 가드를 빼면 누구나 재부트스트랩을 시도할 수 있다 — 단일 테넌트 위반(ADR-007/018).**
  - Supabase `getUser()`로 검증 이메일을 취득(표시용). 신원/키가 없어 실패하면 `redirect("/")`(신원 없이는 팀 생성 불가 — `try/catch`로 감싼다).
- `<CreateTeamForm email={email} />`를 렌더한다(따뜻한 환영 톤, USER_JOURNEY 첫인상과 일관).

`components/setup/create-team-form.tsx` (신규, `"use client"`):
- 팀 이름 입력 + 검증(빈 값은 토스트가 아니라 **인라인** 안내, R30) → `POST /api/workspace { name }`.
- 성공 → `window.location.href = "/dashboard"`. 실패 → 인라인 에러(따뜻한 카피). 진행 중 버튼 `disabled`.
- `components/ui`의 Card/Input/Button과 디자인 토큰을 사용한다(`settings-view.tsx`의 fetch/에러 처리 결과 동일한 결).

`components/settings/settings-view.tsx` (수정):
- 맨 아래에 "**계정**" Card + **로그아웃** Button을 추가한다.
- onClick → `POST /api/auth/logout` → 성공 시 `window.location.href = "/"`. 진행 중 `disabled`.
- **CRITICAL: 새 엔드포인트/Server Action을 만들지 마라 — 기존 `POST /api/auth/logout`을 호출한다.**

## Acceptance Criteria

```bash
npx tsc --noEmit
npx vitest run components/settings components/setup
npm run build
npm test
```

TDD 테스트(fetch 목):
- 설정: 로그아웃 버튼 클릭 → `/api/auth/logout` `POST` 호출.
- create-team-form: 빈 이름 → 인라인 에러 + `POST` 미발생; 정상 입력 → `/api/workspace` `POST`.

## 금지사항

- 로그아웃용 새 엔드포인트/Server Action을 만들지 마라. 이유: 기존 `POST /api/auth/logout`이 있다.
- `/setup`의 `getWorkspace()` 가드를 빼지 마라. 이유: 재부트스트랩 허용 = 단일 테넌트 위반(ADR-007/018).
- 클라이언트에서 Supabase/DB를 직접 호출하지 마라. 이유: CLAUDE.md CRITICAL(외부/DB는 route handler/Server Action만). fetch는 자체 API로만.
- E2E(Playwright)를 추가하지 마라. 이유: 부트스트랩은 Supabase OAuth 신원이 필요해 헤드리스로 통과 불가 — 이 레이어는 RTL로 검증한다.
- 기존 설정 화면 동작(프로필·알림·테마·법적 링크)을 깨뜨리지 마라.
