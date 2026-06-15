# Step 1: team-scoped-schema

엔티티에 `teamId`를 추가하고 기존 데이터를 부트스트랩 팀으로 백필하는 **스키마 + 백필 코드 + 테스트**를 만든다. **운영 DB에 `prisma db push`를 실행하지 않는다**(검토된 수동 단계, ADR-020).

## 읽어야 할 파일

먼저 아래를 읽고 설계 의도를 파악하라. **정본은 루트 `README.md` · `CLAUDE.md` · `PRD.md`.**

항상:
- `docs/dev/ARCHITECTURE.md` · `docs/agent/ADR.md`(**ADR-020·ADR-018·ADR-019·ADR-010**) · `docs/dev/CODING_CONVENTION.md`

데이터 레이어:
- `docs/dev/DB.md` — 모델 규칙(SQLite 호환: enum 대신 String, 배열은 Json)
- `docs/agent/RULES.md` — R37·R3

수정 대상 코드:
- `prisma/schema.prisma` — 현재 모델(`Paper`·`Presentation`·`ScheduleMonth`·`ScheduleWeek`·`FineConfig`·`MemberLedger`·`LiveSession`·`Team`·`Membership`)
- `prisma/seed.ts` — 멀티팀 이관(하박조팽→Team 1개) 로직 — 부트스트랩 팀 식별 패턴 참고
- `prisma/__tests__/seed.test.ts` — 백필 테스트를 여기/별도 파일에 추가
- `types/entities.ts` — DTO

## 작업

### 1. `prisma/schema.prisma` — teamId 추가 + 제약 변경

아래 모델에 `teamId String`를 추가하고 `@@index([teamId])`를 단다:
- `Paper`, `Presentation`, `LiveSession` — teamId 추가 + 인덱스. (기존 고유 제약 없음 → 단순 additive.)
- `ScheduleMonth` — teamId 추가. **`@@unique([year, month])` → `@@unique([teamId, year, month])`** (팀별 월 독립).
- `FineConfig` — 현재 `year Int @id`. **`year`의 `@id`를 제거하고 `teamId String` 추가 후 `@@id([teamId, year])`** (복합 PK). 관계 필드 정합:
  - `MemberLedger`는 현재 `@relation(fields:[year], references:[year])`. **`teamId String` 추가 + 관계를 `@relation(fields:[teamId, year], references:[teamId, year])`로**, `@@unique([year, memberId])` → **`@@unique([teamId, year, memberId])`**.
- 하위 엔티티(`Analysis`·`Figure`·`SectionNote`·`Comment`·`ScheduleWeek`·`PresentationAsset`·`PresentationVersion`·`Reaction`·`Participant`)는 **teamId를 추가하지 않는다** — 부모(Paper/Presentation/ScheduleMonth/LiveSession)를 통해 스코핑된다.

`npx prisma generate`로 클라이언트를 갱신한다.

> **CRITICAL: `teamId`는 non-null(`String`)로 둔다 — 단, 운영 push는 수동 단계라 step에서 prod에 적용하지 않는다.** 로컬/테스트(SQLite 또는 mock)에서만 generate·검증한다. 마이그레이션 절차(nullable 추가→백필→non-null, 또는 default 후 백필)는 step 5의 수동 가이드에 적는다.

### 2. 백필 로직 (`lib/backfill-teams.ts` 또는 seed에 함수)

```ts
/** teamId 없는 기존 행을 부트스트랩 팀(가장 먼저 생성된 Team = seed 이관 '하박조팽')으로 채운다. 멱등. */
export async function backfillTeamScoping(): Promise<{ team: string; updated: Record<string, number> }>;
```
규칙:
- 부트스트랩 팀 = `prisma.team.findFirst({ orderBy: { createdAt: "asc" } })`. 팀이 0개면 아무것도 안 함(안전).
- `Paper`·`Presentation`·`ScheduleMonth`·`FineConfig`·`MemberLedger`·`LiveSession`에서 teamId가 비어 있는(또는 부트스트랩 대상) 행을 그 팀으로 업데이트.
- **멱등**: 두 번 돌려도 안전(이미 채워진 행은 재변경 없음).
- **CRITICAL: 운영 DB를 직접 건드리지 않는다.** 이 함수는 step 5의 수동 절차/시드에서 호출된다 — 이 step에서 prod로 실행하지 마라.

### 3. 타입 (`types/entities.ts`)
teamId를 포함한 DTO 갱신(필요 시). `any` 금지.

## Acceptance Criteria

```bash
npx prisma generate
npm run build
npm test
```

테스트(먼저 작성, `prisma/__tests__`):
- `backfillTeamScoping`: 부트스트랩 팀 선택(최초 createdAt)·기존 행 teamId 채움·멱등(2회 호출 동일 결과)·팀 0개일 때 no-op. (테스트 DB는 기존 seed.test 패턴 사용 — 로컬 SQLite/테스트 DB.)
- 스키마 변경이 `prisma generate`를 깨지 않고 빌드 통과.

## 검증 절차

1. AC 실행.
2. 체크리스트:
   - teamId가 6개 모델에 추가됐고 하위 엔티티엔 안 들어갔는가?
   - 고유 제약(ScheduleMonth/FineConfig/MemberLedger)이 팀 포함으로 바뀌었는가?
   - 백필이 멱등·부트스트랩 팀 대상인가?
   - **운영 DB에 push하지 않았는가?**(중요)
3. `phases/8-team-scoping/index.json`의 step 1 업데이트(completed+summary / error).
   - summary에 "운영 `prisma db push`·백필 실행은 step 5 수동 절차" 명시.

## 금지사항

- **`prisma db push`/`prisma migrate deploy`를 운영 DB에 실행하지 마라.** 이유: 공유 운영 DB에 제약/PK 변경은 위험 — 검토된 수동 단계다(ADR-020). 헤드리스 자율 실행 금지.
- **하위 엔티티(Analysis·Figure·Comment 등)에 teamId를 추가하지 마라.** 이유: 부모를 통해 스코핑된다 — 중복은 정합성 부채.
- **백필을 "전체 팀에 복제"로 만들지 마라.** 이유: 기존 데이터는 한 워크스페이스(부트스트랩 팀) 것이다 — 다른 팀에 새지 않게.
- 기존 테스트를 깨뜨리지 마라(seed.test 포함 — 멀티팀 이관 단언 유지).
