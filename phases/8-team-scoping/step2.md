# Step 2: active-team-context

"활성 팀"을 쿠키로 영속화하고, 멤버십으로 검증하며, TeamSwitcher가 실제로 전환하게 만든다. (현재는 layout이 `teams[0]`을 무조건 활성으로 쓴다 — 영속 선택 없음.)

## 읽어야 할 파일

먼저 아래를 읽고 설계 의도를 파악하라. **정본은 루트 `README.md` · `CLAUDE.md` · `PRD.md`.**

항상:
- `docs/dev/ARCHITECTURE.md`(RSC/쿠키·세션) · `docs/agent/ADR.md`(**ADR-020·ADR-018**) · `docs/dev/CODING_CONVENTION.md`
- `docs/agent/RULES.md` — R37·R3·R19·R32

이전 step 산출물:
- step 1의 스키마(teamId)·`types/entities.ts`

수정/참고 대상:
- `lib/teams.ts` — `resolveEntryTeam`·`listMemberships`·`getMembership`(그대로 사용)
- `lib/auth.ts` — 세션(`memberId`) 취득 패턴(쿠키 읽기/서명 참고)
- `app/(app)/layout.tsx` — `activeTeamSlug = teams[0]?.slug`를 활성 팀 해소로 교체
- `components/shell/` — `TeamSwitcher`(현재 전환 링크만; 실제 전환 배선)
- `lib/redirect.ts` — same-origin 검증 패턴 참고

## 작업

### 1. `lib/active-team.ts` (서버 전용)

```ts
/** 활성 팀 slug를 해소한다: 쿠키 값이 내 멤버십이면 그걸, 아니면 resolveEntryTeam(최근 합류). 팀 없으면 null. */
export async function getActiveTeamSlug(memberId: string): Promise<string | null>;

/** 활성 팀의 { id, slug, role } 해소(쿼리 스코핑에 쓸 teamId). 멤버십 아니면 null. */
export async function getActiveTeam(memberId: string): Promise<{ id: string; slug: string; role: TeamRole } | null>;

/** 활성 팀 쿠키를 설정한다(검증: slug가 memberId의 멤버십이어야). 아니면 거부(throw/false). */
export async function setActiveTeam(memberId: string, slug: string): Promise<void>;
```
규칙:
- 쿠키 이름 예: `active_team`. **값은 멤버십 검증 후에만 신뢰** — 쿠키에 임의 slug가 와도 내 멤버십이 아니면 무시하고 `resolveEntryTeam`로 폴백(R3/R19).
- `getActiveTeam`은 slug→Team.id 해소까지(스코핑 쿼리가 teamId를 쓴다).
- 쿠키는 `next/headers`의 cookies()로. HttpOnly·SameSite=Lax.

### 2. 전환 경로
- `POST /api/teams/active`(또는 Server Action) `{ slug }` → `setActiveTeam` → 성공 시 `revalidatePath`로 셸/화면 갱신. 미멤버십 slug는 `403`.
- `components/shell`의 `TeamSwitcher`가 이 경로를 호출해 활성 팀을 바꾸고 화면을 새로고침/revalidate.

### 3. layout 배선
- `app/(app)/layout.tsx`: `activeTeamSlug = teams[0]?.slug` → `await getActiveTeamSlug(session.memberId)`로 교체. (가드·팀없음 로직은 유지.)

## Acceptance Criteria

```bash
npm run build
npm test
```

테스트(먼저 작성):
- `lib/__tests__/active-team.test.ts`: 쿠키가 유효 멤버십 → 그 팀 / 무효(미멤버십) → resolveEntryTeam 폴백 / 쿠키 없음 → 최근 합류 / 팀 0개 → null. `setActiveTeam` 미멤버십 거부.
- 전환 라우트/액션: 미멤버십 slug 403, 성공 시 쿠키 설정 + revalidate(목으로 확인).

## 검증 절차

1. AC 실행.
2. 체크리스트: 쿠키 값을 멤버십 검증 후에만 신뢰하는가(R3/R19)? 폴백이 resolveEntryTeam인가? layout이 활성 팀을 쓰는가?
3. `phases/8-team-scoping/index.json`의 step 2 업데이트.

## 금지사항

- **쿠키의 활성 팀을 검증 없이 신뢰하지 마라.** 이유: 임의 slug로 다른 팀을 활성화하면 격리가 깨진다 — 반드시 멤버십 확인(R19).
- **도메인 쿼리 스코핑을 여기서 하지 마라.** 이유: 활성 팀 해소까지가 이 step. 실제 필터는 step 3·4.
- 기존 테스트를 깨뜨리지 마라.
