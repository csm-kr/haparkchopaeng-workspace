# Step 2: entry-cutover

진입 배선을 팀 허브(`/teams`)로 **원자적으로 전환**하고, 흡수된 `app/(app)/teams/new/`를 삭제한다. 로그인 후 기본 착지와 "팀 없음" 가드 목적지를 전부 `/teams`로 바꾼다.

## 읽어야 할 파일

먼저 아래를 읽고 설계 의도를 파악하라. **정본은 루트 `README.md` · `CLAUDE.md` · `PRD.md`이며, 충돌 시 이를 따른다.**

항상:
- `docs/dev/ARCHITECTURE.md` · `docs/agent/ADR.md`(**ADR-021** 진입 팀 허브 · ADR-018 · ADR-020) · `docs/dev/CODING_CONVENTION.md`

인증/플로우 레이어:
- `docs/agent/RULES.md` — R3·R19·R37
- `docs/security/SECURITY.md` — 오픈 리다이렉트 차단(`sanitizeNext`)은 그대로 유지해야 한다

step 1에서 만들어진 것(읽고 이어간다):
- `app/teams/page.tsx` · `team-picker.tsx` · `create-team-form.tsx` · `actions.ts` — 허브(이미 동작, `/teams`에서 도달 가능)
- `lib/teams.ts`의 `canCreateTeam`

수정/삭제 대상(전부 읽어 현재 동작 확인):
- `app/auth/callback/route.ts` — 로그인 후 `next ?? "/dashboard"`
- `app/page.tsx` — 이미 로그인 시 `next ?? "/dashboard"`
- `app/(app)/layout.tsx` — `needsTeamOnboarding` true면 `redirect("/teams/new")`
- `lib/redirect.ts` — `ONBOARDING_EXEMPT = ["/teams/new", "/invite"]`, `needsTeamOnboarding`
- `lib/__tests__/redirect.test.ts` — `needsTeamOnboarding` 단언(`/teams/new` 포함)
- `middleware.ts` — 주석에 `/teams/new` 언급
- "팀 없음 → `/teams/new`" 리다이렉트가 있는 RSC 6곳:
  - `app/(app)/dashboard/page.tsx`
  - `app/(app)/library/page.tsx`
  - `app/(app)/presentations/page.tsx`
  - `app/(app)/presentations/[id]/page.tsx`
  - `app/(app)/papers/[id]/page.tsx`
  - `app/(app)/schedule/page.tsx`
- `app/(app)/teams/new/` — 삭제 대상 디렉토리

## 작업

### 1. 기본 착지 전환 — 로그인 후 `/teams`
- `app/auth/callback/route.ts`: 마지막 리다이렉트를 `next ?? "/dashboard"` → **`next ?? "/teams"`**. **초대 복귀(`next`) 우선·`sanitizeNext` 정제는 그대로 유지**(SECURITY).
- `app/page.tsx`: 이미 로그인 상태 분기 `redirect(next ?? "/dashboard")` → **`redirect(next ?? "/teams")`**.

### 2. "팀 없음" 가드 목적지 전환 — `/teams/new` → `/teams`
- `app/(app)/layout.tsx`: `redirect("/teams/new")` → **`redirect("/teams")`**. 관련 주석도 정정.
- RSC 6곳의 `if (!team) redirect("/teams/new")` → **`redirect("/teams")`** (활성 팀 미해소 시 허브로).
- `lib/redirect.ts`:
  - `ONBOARDING_EXEMPT`에서 **`/teams/new` 제거**. `/teams`는 `(app)` **밖**이라 `needsTeamOnboarding`(=(app) 레이아웃 가드)을 타지 않으므로 예외 목록에 **추가할 필요 없다**. `/invite`는 유지.
  - `needsTeamOnboarding` 동작/주석을 "팀 없음 → `/teams`(허브)"로 정정. 함수 시그니처·로직 구조는 유지(예외 경로 판정만 갱신).
- `middleware.ts`: 주석의 `/teams/new` 언급을 `/teams`로 정정(헤더 주입 로직은 무변경).

### 3. 흡수된 화면 삭제
- `app/(app)/teams/new/` 디렉토리 전체 삭제(`page.tsx`·`create-team-form.tsx`·`actions.ts`). step 1에서 허브가 자체 폼/액션을 가지므로 중복 해소.
- 삭제 후 `/teams/new`로의 잔존 import/참조가 없는지 확인(`grep`).

### 4. 단위 테스트 갱신
- `lib/__tests__/redirect.test.ts`: `needsTeamOnboarding` 단언을 갱신한다.
  - `/teams/new` 관련 단언 제거(그 경로는 더 이상 특별 취급 안 함 — 일반 (app) 경로처럼 멤버십 없으면 가드 대상이 되지만, 라우트 자체가 사라졌으므로 단언에서 뺀다).
  - `/invite`는 여전히 예외(미합류 사용자 합류 경로) — 단언 유지.
  - `sanitizeNext` 단언은 그대로.

## Acceptance Criteria

```bash
npm run build      # 타입/컴파일 에러 없음 (/teams/new 잔존 참조 0)
npm test           # Vitest — redirect 단위 갱신 포함 전체 green
npm run lint
```

추가 확인:
- `grep -rn "/teams/new" app lib middleware.ts tests` 결과가 0(주석·코드·테스트 모두). 문서(`docs/`)는 step 0 소관이라 제외.

## 검증 절차

1. AC 실행.
2. 체크리스트:
   - 로그인 후 기본 착지가 `/teams`인가? **초대 `next`는 여전히 우선**인가(`sanitizeNext` 유지)?
   - "팀 없음" 가드(layout) + RSC 6곳 + 그 외가 모두 `/teams`로 가는가?
   - `app/(app)/teams/new/`가 삭제됐고 잔존 참조 0인가?
   - `lib/redirect.ts`의 예외 목록에서 `/teams/new`가 빠지고 `/invite`는 남았는가?
   - 오픈 리다이렉트 차단(`sanitizeNext`)을 약화시키지 않았는가(SECURITY)?
3. `phases/9-team-hub/index.json`의 step 2 업데이트(`completed`+`summary` / `error`).

## 금지사항

- **`sanitizeNext`(오픈 리다이렉트 차단)를 제거·완화하지 마라.** 이유: 초대 `next` 복귀의 보안 경계다(SECURITY) — `/teams`로 바뀌는 건 기본값뿐이다.
- **활성 팀 쿠키 로직(`lib/active-team.ts`)·`/api/teams/active`를 바꾸지 마라.** 이유: 허브 선택이 그대로 재사용한다 — 진입 배선만 바꾼다.
- **`createTeam`/`maxTeams` 전역 상한을 건드리지 마라.** 이유: ADR-021 — 정책 무변경.
- **`/teams`를 `ONBOARDING_EXEMPT`에 넣지 마라.** 이유: `/teams`는 `(app)` 밖이라 가드를 타지 않는다 — 불필요한 예외는 혼동만 만든다.
- 기존 테스트를 깨뜨리지 마라(특히 `entry.spec.ts`는 step 3에서 갱신 — 여기서 깨지면 step 3 AC가 가린다는 가정 금지, build/unit은 green이어야 함).
