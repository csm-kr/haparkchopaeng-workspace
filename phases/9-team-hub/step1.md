# Step 1: hub-screen

팀 허브 화면 `app/teams/`를 **(app) 셸 밖의 독립 로비**로 신규 추가하고, 생성 상한 가시화에 필요한 `canCreateTeam()` 도메인 헬퍼를 만든다. **이 step은 순수 additive다 — 기존 라우트·리다이렉트·가드는 건드리지 않는다.** 허브는 `/teams`에서 도달만 가능하고, "기본 착지"로 배선하는 일과 `/teams/new` 삭제는 step 2가 한다.

## 읽어야 할 파일

먼저 아래를 읽고 설계 의도를 파악하라. **정본은 루트 `README.md` · `CLAUDE.md` · `PRD.md`이며, 충돌 시 이를 따른다.**

항상:
- `docs/dev/ARCHITECTURE.md` — 스택·디렉토리 구조
- `docs/agent/ADR.md` — **ADR-021(step 0에서 추가, 진입 팀 허브)** · ADR-018(멀티팀) · ADR-020(활성 팀) · ADR-015(읽기 RSC·쓰기 Server Action)
- `docs/dev/CODING_CONVENTION.md` — 코드 규칙

화면/UI + 데이터 레이어:
- `docs/design/DESIGN_GUIDE.md` · `docs/design/SCREENS.md`(step 0의 팀 허브 명세) · `docs/user/USER_FLOW.md`
- `docs/agent/RULES.md` — **R3**(신원은 세션에서) · **R19**(앱레벨 권한) · **R30**(실패는 인라인) · **R37**(활성 팀)

수정/참고 대상 코드(꼭 읽어라):
- `lib/teams.ts` — `maxTeams()`(env `MAX_TEAMS`, 기본 2, 전역), `createTeam`, `listMemberships(memberId): TeamSummary[]`(최근 합류 순, role 포함)
- `lib/__tests__/teams.test.ts` — 단위 테스트 패턴(여기에 `canCreateTeam` 테스트 추가)
- `lib/auth.ts` — `getSession()`(세션 없으면 null)
- `app/(app)/teams/new/page.tsx` · `create-team-form.tsx` · `actions.ts` — 현재 팀 만들기 화면/액션(이걸 허브용으로 옮겨 적는다 — 아래 참고)
- `components/shell/team-switcher.tsx` — `POST /api/teams/active` 호출 → `router.refresh()` 패턴(팀 선택 섬이 이 패턴을 따른다)
- `app/api/teams/active/route.ts` — 활성 팀 전환 API(그대로 재사용)
- `components/ui` — `Card`·`Button`·`Input` 등 공용 UI

## 작업

### 1. `lib/teams.ts` — `canCreateTeam()` 추가 (TDD 먼저)

먼저 `lib/__tests__/teams.test.ts`에 테스트를 추가한 뒤 구현한다.

```ts
/** 전역 팀 생성 가능 여부 — 서버 전체 team.count()가 maxTeams() 미만이면 true. (per-user 아님, ADR-021) */
export async function canCreateTeam(): Promise<boolean>;
```
- 구현은 `(await prisma.team.count()) < maxTeams()`. `maxTeams()`는 호출 시점에 env를 읽는다(기존 R2 패턴).
- 테스트: 상한 미달 → true / 상한 도달(==) → false / 초과 → false. `prisma.team.count`를 목(기존 teams.test 목 패턴 따름).

> **CRITICAL: 상한은 전역(서버 전체 count)이다. per-user 카운트(`membership` 기준 등)로 바꾸지 마라.** 이유: ADR-021에서 전역·admin/env로 확정 — per-user는 미도입.

### 2. `app/teams/` 신규 — 독립 로비 (셸 밖)

`app/teams/` 디렉토리를 만든다. **`app/(app)/` 안이 아니다** — `(app)/layout` 셸·가드를 타지 않는 독립 화면이다(`/invite`와 같은 위치 계층).

#### 2-1. `app/teams/page.tsx` (RSC)
- `getSession()` → 없으면 `redirect("/")`.
- `listMemberships(session.memberId)`로 내 팀 목록, `canCreateTeam()`로 생성 가능 여부 계산(읽기는 서버에서, ADR-015).
- 렌더: 내 팀 목록(아래 `TeamPicker`) + 새 팀 만들기(`CreateTeamForm`, `canCreate` 전달) + 초대 안내 문구. 팀이 0개면 목록은 비고 만들기/초대를 전면에.
- 디자인은 `DESIGN_GUIDE.md`·기존 `app/(app)/teams/new/page.tsx`의 카드 스타일을 따른다.

#### 2-2. `app/teams/team-picker.tsx` (`"use client"`)
선택 인터랙션 섬. `components/shell/team-switcher.tsx`와 **동일 패턴**:
```ts
export interface TeamPickerProps {
  teams: { slug: string; name: string; role: string }[];
}
```
- 각 팀 버튼 클릭 → `fetch("/api/teams/active", { method: "POST", body: JSON.stringify({ slug }) })` → 성공 시 `router.push("/dashboard")`.
- 전환 중 비활성(중복 클릭 방지). `teams`가 비면 아무것도 렌더하지 않는다(빈 상태 문구는 `page.tsx`가 담당).

> **CRITICAL: 활성 팀 설정은 서버가 멤버십을 검증한다(`setActiveTeam`).** 클라가 보낸 slug를 신뢰하지 않는다(R3/R19) — 이 검증은 기존 `/api/teams/active`가 이미 하므로 **새 검증 경로를 만들지 마라**. 그냥 재사용한다.

#### 2-3. `app/teams/create-team-form.tsx` (`"use client"`) + `app/teams/actions.ts` (`"use server"`)
`app/(app)/teams/new/`의 `create-team-form.tsx`·`actions.ts`를 **이 위치에 옮겨 적는다**(허브 소유). 단, 폼에 상한 가시화를 추가한다:
```ts
export interface CreateTeamFormProps {
  canCreate: boolean;   // false면 입력·버튼 비활성 + 안내
}
```
- `canCreate === false`: 입력/버튼을 비활성화하고 **"최대 팀 수에 도달했어요. (관리자 설정)"** 안내를 인라인으로(R30). 토스트 금지.
- `canCreate === true`: 기존 동작(이름·선택 slug 입력 → `createTeamAction` → 성공 시 `router.push("/dashboard")`; `router.refresh()`).
- `actions.ts`의 `createTeamAction`은 기존 로직 그대로(신원은 세션 `requireAuth`에서 — R3, 결과는 판별 유니온 → 인라인 처리 R30). `TEAM_LIMIT`(서버 강제) 실패도 그대로 인라인.

> **NOTE(의도된 일시 중복): 이 step에서는 `app/(app)/teams/new/`를 삭제하지 않는다.** 따라서 폼/액션이 잠시 두 곳에 존재한다 — 정상이다. 구 디렉토리 삭제와 진입 배선은 step 2가 한다. step 2 전까지 build를 green으로 유지하기 위함이다.

### 3. RTL 컴포넌트 테스트

허브 화면을 검증한다(`app/teams/__tests__/` 또는 컨벤션 위치). 서버 의존은 목으로:
- 팀 2개 전달 → 두 팀 이름이 렌더되고 선택 버튼이 보인다.
- `canCreate=false` → 만들기 입력/버튼 비활성 + "최대 팀 수에 도달했어요" 안내.
- `canCreate=true` → 만들기 폼 활성.
- (필요 시 `useRouter`·`fetch` 목 — `components/shell/__tests__/team-switcher.test.tsx` 패턴 참고.)

## Acceptance Criteria

```bash
npm run build      # 타입/컴파일 에러 없음
npm test           # Vitest + RTL — canCreateTeam 단위 + 허브 컴포넌트 테스트
```

## 검증 절차

1. AC 실행.
2. 체크리스트:
   - `app/teams/`가 `(app)` **밖**에 있고 셸/가드를 타지 않는가?
   - `canCreateTeam`이 **전역 count** 기준인가(per-user 아님)?
   - 팀 선택이 **기존 `/api/teams/active`를 재사용**하는가(새 검증 경로 없음)?
   - 상한 도달 시 만들기 비활성 + 인라인 안내(R30)인가?
   - 기존 라우트/리다이렉트/가드를 **건드리지 않았는가**(이 step은 additive)?
3. `phases/9-team-hub/index.json`의 step 1 업데이트(`completed`+`summary` / `error`).
   - summary에 "허브는 `/teams`에서 도달만 가능, 진입 배선·`/teams/new` 삭제는 step 2" 명시.

## 금지사항

- **기존 라우트·리다이렉트·가드(`auth/callback`·`app/page.tsx`·`(app)/layout`·RSC 6곳·`lib/redirect.ts`·`middleware.ts`)를 수정하지 마라.** 이유: 진입 배선 전환은 step 2의 원자적 작업이다 — 여기서 손대면 중간 상태가 깨진다.
- **`app/(app)/teams/new/`를 삭제하지 마라.** 이유: 아직 거기로 가는 리다이렉트가 살아 있다(step 2에서 함께 정리).
- **활성 팀 설정용 새 API/Server Action을 만들지 마라.** 이유: `POST /api/teams/active`가 멤버십 검증까지 이미 한다 — 중복은 보안 표면만 늘린다(R19).
- **`createTeam`/`maxTeams`의 전역 상한 로직을 per-user로 바꾸지 마라.** 이유: ADR-021 — 전역·admin/env 확정.
- 기존 테스트를 깨뜨리지 마라.
