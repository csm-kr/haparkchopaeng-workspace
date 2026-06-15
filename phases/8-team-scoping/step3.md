# Step 3: scoped-reads

도메인 **읽기**를 활성 팀으로 스코핑한다. 논문·발표자료·스케줄·벌금·대시보드 조회가 활성 팀 데이터만 반환하게. (쓰기·라이브는 step 4.)

## 읽어야 할 파일

먼저 아래를 읽고 설계 의도를 파악하라. **정본은 루트 `README.md` · `CLAUDE.md` · `PRD.md`.**

항상:
- `docs/dev/ARCHITECTURE.md`(읽기=RSC 서버 조회) · `docs/agent/ADR.md`(**ADR-020·ADR-015**) · `docs/dev/CODING_CONVENTION.md`
- `docs/agent/RULES.md` — **R37·R19·R26**(빈 상태)·R32

이전 step 산출물:
- step 1 스키마(teamId), step 2 `lib/active-team.ts`(`getActiveTeam`)

수정 대상(읽기 경로 — 코드를 읽고 스코핑 지점 파악):
- `lib/papers.ts` · `lib/presentations.ts` · `lib/schedule.ts` · `lib/dashboard.ts` — 조회 함수
- 벌금 데이터 접근(`FineConfig`/`MemberLedger`) — 위치를 찾아서(lib 또는 route) 스코핑
- RSC 페이지: `app/(app)/dashboard/page.tsx` · `library/page.tsx` · `presentations/page.tsx` · `papers/[id]/page.tsx` · `presentations/[id]/page.tsx` · `schedule/page.tsx`
- 관련 GET 라우트: `app/api/papers` · `app/api/presentations` · `app/api/schedule/...` · `app/api/fines/...`

## 작업

읽기 함수/라우트에 **활성 팀 teamId 필터**를 추가한다:
- 조회 함수 시그니처에 `teamId`를 받게 하고(예: `listPapers(teamId)`), `where: { teamId, ... }`로 필터.
- RSC 페이지는 `const team = await getActiveTeam(session.memberId)` 후 `teamId`를 조회 함수에 전달. 팀 없으면 layout 가드가 이미 처리(방어적으로 빈/리다이렉트).
- 단건 조회(`papers/[id]`·`presentations/[id]`)는 **teamId 일치 확인** — 다른 팀 엔티티면 404(존재 숨김) 또는 403. (존재 자체를 숨기려면 404 권장.)
- 빈 상태: 팀에 데이터가 없으면 정직한 빈 상태(R26/R21) — 팀별로.

**불변식(교차 팀 격리)**: 활성 팀이 A면 B의 논문/발표자료/스케줄/벌금이 **절대** 조회에 섞이지 않는다.

## Acceptance Criteria

```bash
npm run build
npm test
```

테스트(먼저 작성):
- **교차 팀 읽기 격리**: 팀 A 활성일 때 `listPapers(A)`·`listPresentations(A)` 등이 B 데이터를 포함하지 않음. 단건 조회는 다른 팀 id → 404/403.
- 빈 팀 → 빈 목록(에러 아님).
- prisma는 목/테스트 DB. (공유 운영 DB에 쓰지 않는다.)

## 검증 절차

1. AC 실행.
2. 체크리스트: 모든 도메인 읽기가 teamId로 필터되는가(R37)? 단건은 교차 팀 차단(R19)? 빈 상태 정직(R26)? 운영 DB 미접촉?
3. `phases/8-team-scoping/index.json`의 step 3 업데이트.

## 금지사항

- **teamId 필터 없는 도메인 조회를 남기지 마라.** 이유: 한 곳이라도 빠지면 교차 팀 유출(R37/R19).
- **쓰기·라이브를 여기서 스코핑하지 마라.** 이유: step 4 범위(scope 최소화).
- **운영 DB에 쓰지 마라.** 이유: 테스트는 목/테스트 DB. 마이그레이션은 수동(step 5).
- 기존 테스트를 깨뜨리지 마라.
