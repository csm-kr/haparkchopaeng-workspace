# 팀 — 삭제(관리자/owner) · 탈퇴(본인) 설계

- 날짜: 2026-06-18
- 상태: 승인됨 (구현 진행)
- 관련: ADR-018(멀티팀)·ADR-021(팀 허브)·ADR-015/R32(RSC 읽기·Server Action 쓰기)·ADR-020/R37(팀 스코핑)·R19(앱레벨 권한)·R27(파괴적 확인)·R30(판별 유니온). `app/teams/*`, `lib/teams.ts`, `components/team/team-manager.tsx`, `app/api/teams/[slug]/members/[memberId]/route.ts`

## 배경 / 문제

멀티팀(ADR-018) 도입 후 팀을 **만들기**는 되지만 **지우기**는 어디에도 없다. 운영상 잘못 만든 팀·테스트 팀이 쌓여도 정리할 길이 없고, 전역 팀 상한(`MAX_TEAMS` 기본 2)에 막힌다. 또한 멤버가 한 팀에서 **스스로 나가는(탈퇴)** UI가 없다 — 서버(`DELETE …/members/:id`)는 본인 탈퇴를 이미 허용하는데 화면에 버튼이 없어 도달 불가.

세 가지를 정리한다: **팀 삭제**(신규) · **팀 탈퇴**(UI만 신규) · **추방**(이미 완성, 무변경 확인).

## 목표

1. **팀 삭제** — 전역 관리자(`Member.role === "관리자"`)는 **아무 팀이나**, 팀 owner는 **자기 팀**을 삭제할 수 있다. 팀과 그 팀에 속한 모든 데이터가 함께 사라진다.
2. **팀 탈퇴** — owner가 아닌 멤버는 `팀 관리` 화면에서 **스스로 그 팀을 나갈** 수 있다.
3. **추방** — owner는 owner가 아닌 멤버를 내보낼 수 있다(이미 동작 — 회귀만 보장).

## 범위

**In**
- `lib/teams.ts`: `deleteTeam(teamId)` — 팀 스코프 데이터를 트랜잭션으로 cascade 삭제.
- `app/teams/actions.ts`: `deleteTeamAction(slug)` — 권한 강제(R19) + 판별 유니온 결과(R30).
- `app/teams/page.tsx`: 삭제 가능한 팀 목록을 서버에서 계산해 새 섹션에 전달.
- `app/teams/delete-team-section.tsx`(신규 클라 섬): 삭제 가능한 팀 나열 + **이름 타이핑 확인** 다이얼로그(R27) → `deleteTeamAction` 호출.
- `components/team/team-manager.tsx`: owner가 아닐 때 본인 행에 **`팀 나가기`** 버튼 + 확인 → 기존 `DELETE /api/teams/:slug/members/:본인` 호출 → 성공 시 `/teams`로 이동.
- 위 전부 TDD(테스트 먼저).

**Out (이번 범위 아님)**
- **Supabase 스토리지 파일 삭제** — 논문 PDF·발표 에셋 등 스토리지 오브젝트는 지우지 않는다(DB 행만). 고아 오브젝트는 best-effort로 남긴다. 빈번해지면 후속(스토리지 정리 잡).
- **`Job` 정리** — `payload.paperId`로 논문을 참조하지만 `teamId`가 없다. 삭제된 논문을 가리키는 잡은 처리 시 no-op로 흘려보낸다.
- **owner 양도/owner 탈퇴** — owner는 탈퇴 불가(팀당 owner ≥ 1, 라우트가 이미 차단). owner가 빠지려면 **팀 삭제**를 쓴다. 양도 기능은 만들지 않는다.
- **전역 관리자 승격 UI** — `Member.role` 변경 화면은 만들지 않는다(현재 조성민 1인). 권한 게이트는 역할 기반이라 DB에서 역할을 바꾸면 자동 반영된다.
- **추방 로직·멤버 라우트 무변경** — 이미 완성. 회귀 테스트만.

## 권한 모델

| 동작 | 허용 | 강제 위치 |
|---|---|---|
| 팀 삭제 | `role === "관리자"` **또는** 그 팀의 `Membership.role === "owner"` | `deleteTeamAction`(R19) |
| 팀 탈퇴 | 본인이며 `Membership.role !== "owner"` | 기존 `DELETE …/members/:id`(route.ts:65·73) |
| 추방 | owner는 비-owner 누구든 / admin은 member | 기존 라우트(route.ts:74-78) |

CRITICAL: 모든 게이트는 서버가 최종(R19/R3). UI 노출은 보조이며 클라가 보낸 역할을 신뢰하지 않는다.

## 아키텍처 (델타)

| 파일 | 변경 |
|---|---|
| `lib/teams.ts` | `deleteTeam(teamId)` 추가 — `$transaction`으로 FK 없는 팀 스코프 테이블 수동 삭제 후 `team.delete()` |
| `app/teams/actions.ts` | `deleteTeamAction(slug)` 추가 — `requireAuth` → 팀 조회(404) → `관리자 || isTeamOwner`(403) → `deleteTeam` → `revalidatePath("/teams")` |
| `app/teams/page.tsx` | `deletableTeams` 계산(관리자=전체 `team.findMany`, 그 외=`listMemberships`에서 `role==="owner"` 필터)해 새 섹션에 전달 |
| `app/teams/delete-team-section.tsx` | **신규** 클라 섬 — 삭제 가능 팀 나열 + 이름 타이핑 확인 다이얼로그 + `deleteTeamAction` 호출 + `router.refresh()` |
| `components/team/team-manager.tsx` | 비-owner 본인 행에 `팀 나가기` 버튼 + 확인 다이얼로그 + self DELETE + `/teams` 이동 |
| `lib/__tests__/teams.test.ts` | `deleteTeam` cascade/격리 테스트 |
| `app/teams/__tests__/delete-team-action.test.ts` | 액션 권한 테스트(신규) |
| `app/teams/__tests__/delete-team-section.test.tsx` | 섹션 가시성·확인 게이트 테스트(신규) |
| `components/team/__tests__/team.test.tsx` | `팀 나가기` 표시/숨김 + self DELETE 테스트 보강 |

**안 건드림:** `app/api/teams/[slug]/members/[memberId]/route.ts`(탈퇴·추방을 이미 처리), `lib/active-team.ts`(삭제된 팀 쿠키는 `getActiveTeamSlug`가 폴백으로 자연 해소 — 별도 정리 불필요), 멤버 관리 외 라우트·스키마·마이그레이션.

## 동작 상세

### `deleteTeam(teamId)` — cascade 순서

`Membership`·`Invite`만 `onDelete: Cascade`로 Team에 묶여 있다. 나머지 팀 스코프 테이블은 `teamId`가 평범한 String이라 **수동 삭제**해야 한다(자식은 각자의 FK cascade로 정리됨).

```ts
export async function deleteTeam(teamId: string): Promise<void> {
  await prisma.$transaction(async (tx) => {
    // FineConfig는 MemberLedger의 required 관계 부모(기본 Restrict) → 자식 먼저.
    await tx.memberLedger.deleteMany({ where: { teamId } });
    await tx.fineConfig.deleteMany({ where: { teamId } });
    await tx.paper.deleteMany({ where: { teamId } });          // → Analysis·Figure·SectionNote cascade
    await tx.presentation.deleteMany({ where: { teamId } });   // → Asset·Version·Comment→Reaction cascade
    await tx.scheduleMonth.deleteMany({ where: { teamId } });  // → ScheduleWeek cascade
    await tx.liveSession.deleteMany({ where: { teamId } });    // → Participant cascade
    await tx.teamInviteAcceptance.deleteMany({ where: { teamId } }); // 관계 없음 — 수동
    await tx.team.delete({ where: { id: teamId } });           // → Membership·Invite cascade
  });
}
```

- 트랜잭션이라 중간 실패 시 전부 롤백 — 부분 삭제로 인한 고아를 막는다.
- 자식(`Analysis`/`Figure`/`SectionNote`/`PresentationAsset`/`PresentationVersion`/`Comment`/`Reaction`/`ScheduleWeek`/`Participant`)은 DB FK `onDelete: Cascade`로 자동 정리(스키마에 이미 선언됨).

### `deleteTeamAction(slug)` — 권한 + 결과

```ts
export type DeleteTeamResult =
  | { ok: true }
  | { ok: false; code: string; message: string };
```

- `requireAuth` 실패 → `UNAUTHORIZED`.
- `slug`로 팀 조회, 없으면 `NOT_FOUND`.
- `allowed = session.role === "관리자" || await isTeamOwner(team.id, session.memberId)`. 아니면 `FORBIDDEN`.
- `deleteTeam(team.id)` 후 `revalidatePath("/teams")`, `{ ok: true }`.
- `creatorId`/역할은 **세션에서**(R3) — 클라 입력 미신뢰.

### `/teams` 허브 — 삭제 섹션

- 서버(`page.tsx`)에서 `deletableTeams: { slug; name }[]` 계산:
  - 관리자: `prisma.team.findMany({ orderBy: { createdAt: "asc" } })` 전체.
  - 그 외: 기존 `listMemberships` 결과에서 `role === "owner"`만.
- `deletableTeams.length > 0`일 때만 **"팀 삭제"** 섹션 렌더(기존 "내 팀" picker·"새 팀 만들기"는 그대로).
- 각 행: 팀 이름 + `삭제` 버튼 → 다이얼로그에서 **팀 이름을 정확히 타이핑**해야 확정 버튼 활성(R27, 오삭제 방지). 확정 → `deleteTeamAction(slug)` → `ok`면 `router.refresh()`, 실패면 인라인 메시지.
- 입장용 picker와 **분리**해 "고르려다 지우는" 사고를 막는다.

### `team-manager` — 팀 나가기

- `currentUserRole !== "owner"`일 때만 본인 행에 `팀 나가기` 버튼 노출(owner는 라우트가 차단 — 버튼도 숨김).
- 클릭 → 확인 다이얼로그("이 팀을 나가면 다시 초대받아야 합류할 수 있어요") → `DELETE /api/teams/${teamSlug}/members/${currentUserId}` → 성공 시 `router.push("/teams")`(접근 권한 상실, 활성 팀은 폴백 해소).
- 추방용 ⋯ 메뉴(`hasMenu`가 `!isSelf`)는 그대로 — 본인엔 메뉴 대신 단일 `팀 나가기`만.

## 흐름

**삭제**
1. 관리자/owner가 `/teams`에서 대상 팀의 `삭제` → 이름 타이핑 확인.
2. `deleteTeamAction` 권한 검증(R19) → `deleteTeam` 트랜잭션 cascade → `revalidatePath`.
3. 클라 `router.refresh()` → 허브에서 해당 팀 사라짐. 활성 팀이었으면 다음 진입 시 폴백 해소.

**탈퇴**
1. 비-owner 멤버가 `팀 관리`에서 `팀 나가기` → 확인.
2. 기존 `DELETE …/members/:본인`(allowed: `isSelf`) → 멤버십 삭제.
3. `/teams`로 이동. 그 팀은 더 이상 목록에 없음.

## 테스트 (TDD — 먼저 작성)

- `lib/__tests__/teams.test.ts` — `deleteTeam`:
  - 팀 A에 papers/presentations/schedule/fine+ledger/live/invite/acceptance/membership 시드 → `deleteTeam(A)` 후 **A 스코프 전부 0건**.
  - 팀 B 데이터는 **그대로 보존**(격리).
  - 존재하지 않는 teamId는 throw(또는 no-op) — 액션이 404를 먼저 거르므로 동작만 합의.
- `app/teams/__tests__/delete-team-action.test.ts` — `deleteTeamAction`:
  - 비로그인 → `UNAUTHORIZED`. 없는 slug → `NOT_FOUND`.
  - 일반 멤버/비멤버(비관리자) → `FORBIDDEN`(삭제 호출 안 됨).
  - **팀 owner(비관리자)** → `ok`, `deleteTeam` 호출됨.
  - **전역 관리자(비멤버)** → `ok`.
- `app/teams/__tests__/delete-team-section.test.tsx`:
  - 관리자=전체 팀 노출 / owner=내 팀만 / 해당 없음=섹션 숨김.
  - 이름 오타 시 확정 비활성, 정확히 입력 시 활성 → 액션 호출.
- `components/team/__tests__/team.test.tsx`(보강):
  - 비-owner 본인 → `팀 나가기` 표시, 확인 → self `DELETE` 호출 → 이동.
  - owner 본인 → `팀 나가기` **미표시**.
  - 회귀: 추방(⋯ → 내보내기) 기존 동작 유지.

## 구현 순서 (각 단계 RED→GREEN)

1. `lib/teams.ts` `deleteTeam` — teams.test.ts(RED) → 구현(GREEN).
2. `app/teams/actions.ts` `deleteTeamAction` — delete-team-action.test.ts(RED) → 구현(GREEN).
3. `app/teams/delete-team-section.tsx` + `page.tsx` 배선 — delete-team-section.test.tsx(RED) → 구현(GREEN).
4. `team-manager.tsx` 팀 나가기 — team.test.tsx 보강(RED) → 구현(GREEN).
5. 전체 `tsc`/`vitest`/`lint` 그린 확인.

## 커밋 정책

사용자가 지시할 때 위 델타 경로만 스테이징해 단독 커밋. conventional commits(`feat(teams): …`). 그 전까지 미커밋 유지.

## 가정 / 미해결

- 스토리지 오브젝트(PDF·에셋)는 DB 삭제 후 고아로 남는다 — 합의된 범위(DB-only).
- Prisma 자식 cascade는 DB FK(`relationMode=foreignKeys`, postgres 기본)로 enforced라고 가정 — 스키마에 `onDelete: Cascade`가 선언돼 있으므로 deleteMany 한 번으로 자식까지 정리.
- 삭제된 팀이 활성 팀 쿠키였어도 `getActiveTeamSlug`의 폴백으로 자연 해소(쿠키 정리 코드 불필요).
- owner 탈퇴/양도는 미지원 — owner는 팀 삭제로 갈음.
