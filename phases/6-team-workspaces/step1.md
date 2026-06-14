# Step 1: team-create (팀 도메인 + 전역 상한 + 생성)

## 읽어야 할 파일
정본은 루트 `README.md`·`CLAUDE.md`·`PRD.md`. 충돌 시 이를 따른다.
- `docs/agent/ADR.md`(ADR-018 멀티팀, ADR-015 RSC/Server Action, ADR-016 앱레벨) · `docs/agent/RULES.md`(R18·R19·R32) · `docs/dev/CODING_CONVENTION.md`
- `prisma/schema.prisma`(step 0의 `Team`·`Membership`) · `types/entities.ts`·`types/enums.ts`(`TeamRole`)
- `lib/auth.ts`(`getSession`/`requireAuth`/세션 구조) · `lib/http.ts`(`HttpError`/`ok`/`fail`) · `lib/prisma.ts`
- `lib/team.ts`(기존 단일-워크스페이스 팀 조회 — 혼동 주의: 이건 기존 기능용)

step 0에서 만든 `Team`/`Membership` 스키마를 읽고 작업하라.

## 작업
팀 생성 도메인을 만든다. 권한은 RLS 없이 **앱레벨**(Server Action/route handler)에서 강제(ADR-016/R19). 이 step은 새 파일 위주라 build가 깨지지 않는다.

1. `lib/teams.ts`(신규, 서버 전용) — 순수/도메인 함수:
   - `MAX_TEAMS` — `process.env.MAX_TEAMS`를 **호출 시점에** 읽고(R2 패턴), 미설정이면 기본 `2`. `export function maxTeams(): number`.
   - `export async function createTeam(input: { name: string; slug?: string; creatorId: string }): Promise<{ id: string; slug: string }>`:
     - 이름 검증(2–30자), slug 검증/정규화(`^[a-z][a-z0-9-]{1,23}$`; 미지정이면 `slugify(name)` → 충돌 시 `-2`,`-3`…).
     - **전역 팀 상한**: `prisma.team.count() >= maxTeams()`면 `HttpError(403, "TEAM_LIMIT", "최대 팀 수를 초과했어요.")` 던진다. (서버 전체 기준 — per-user 아님.)
     - slug 중복이면 `HttpError(409, "SLUG_TAKEN", …)`.
     - **트랜잭션**으로 `Team` 생성 + 생성자를 `owner` `Membership`으로 생성(부분 실패 방지). count→insert race는 트랜잭션 내 재확인으로 방지.
   - 역할 헬퍼(멤버십 조회 기반, 앱레벨):
     - `export async function getMembership(teamId, memberId): Promise<{ role: TeamRole } | null>`
     - `export async function isTeamMember/isTeamAdmin/isTeamOwner(teamId, memberId): Promise<boolean>` (`admin`은 owner+admin, 위계 owner>admin>member).
   - 진입 해소: `export async function resolveEntryTeam(memberId): Promise<{ slug: string } | null>` — 멤버십 있으면 가장 최근 `joinedAt` 팀, 없으면 `null`(= 팀 없음).
2. `app/(app)/teams/new/actions.ts`(신규, `"use server"`) — `createTeamAction(input: { name: string; slug?: string })`:
   - `requireAuth()`로 세션 취득, `creatorId`는 **세션에서**(R3). `createTeam` 호출. 성공 시 `{ ok: true, slug }`, `HttpError`면 `{ ok: false, code, message }` 판별 유니온 반환(UI가 인라인 처리, R30).

CRITICAL:
- 전역 상한은 **서버 전체** `team.count()` 기준(ADR-018: `(지금은)` 전역 2개). per-user 한도·플랜을 만들지 마라.
- `creatorId`는 클라 입력이 아니라 **세션**에서 취한다(R3).
- 팀엔 `owner` ≥ 1 — 생성자는 반드시 `owner`로 들어간다.

## Acceptance Criteria
```bash
npm test        # lib/__tests__/teams.test.ts 신규: ① 상한 미만 생성 OK ② 3번째(상한=2 초과) 생성 시 TEAM_LIMIT ③ slug 충돌 회피 ④ 생성자=owner 멤버십. prisma는 기존 테스트들처럼 vi.mock으로 인메모리 목.
npm run build   # 타입/컴파일 에러 없음
```

## 금지사항
- 기존 `lib/team.ts`(단일 워크스페이스 조회)를 바꾸지 마라. 이유: 기존 기능용, 이번 범위 밖.
- 초대 토큰·합류 로직을 여기서 만들지 마라. 이유: step 2 소관.
- UI를 만들지 마라(Server Action까지만). 이유: step 4 소관.
- 기존 테스트를 깨뜨리지 마라.
