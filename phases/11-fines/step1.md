# Step 1: ledger-actions

벌금을 동작하게 하는 **두 개의 쓰기 경로**(Server Action)를 추가한다 — 연도별 설정 생성과 멤버 장부 편집. **TDD**: 테스트를 먼저 쓰고(RED) 통과하는 구현을 작성한다(GREEN).

이 step은 **서버 로직 레이어만** 다룬다. UI는 step 2가 한다.

## 읽어야 할 파일

먼저 아래를 읽고 설계 의도를 파악하라. **정본은 루트 `README.md` · `CLAUDE.md`와 제품 정의 `docs/user/PRD.md`이며, 충돌 시 이를 따른다.**

항상:
- `docs/dev/ARCHITECTURE.md` — 스택·디렉토리 구조
- `docs/agent/ADR.md` — 결정 근거 (특히 ADR-015 서버 전용 쓰기, ADR-020 팀 스코핑, 그리고 step 0이 추가한 **벌금 장부 수동 편집·설정 명시 생성 ADR**)
- `docs/dev/CODING_CONVENTION.md` — 코드 규칙
- `docs/dev/DB.md` — `FineConfig`·`MemberLedger` 스키마 + 파생 계산(누적 벌금·미납은 저장 안 함)
- `docs/security/SECURITY.md` — 관리자 전용 액션 게이팅

이전 step / 현재 코드(읽고 패턴을 그대로 따를 것):
- `app/(app)/schedule/actions.ts` — **이 파일에 추가한다.** `updateFines`(관리자 전용·활성 팀 스코핑·`getFines` 반환)와 `reorderRotation`(membership으로 팀 멤버만 신뢰)의 패턴을 그대로 재사용하라.
- `app/(app)/schedule/__tests__/actions.test.ts` — **이 파일에 테스트를 추가한다.** 기존 mock 구조(`requireRoleMock`·`getActiveTeamMock`·`getFinesMock`·`prismaMock`·`$transaction`)를 재사용·확장하라.
- `lib/schedule.ts`(`getFines`) — 액션이 갱신 후 최신 `FinesView`를 돌려줄 때 호출.
- `components/schedule/types.ts`(`FinesView`) — 반환 타입.
- `lib/http.ts`(`HttpError`) — 에러 표준.

## 작업

`app/(app)/schedule/actions.ts`에 Server Action 2개를 추가한다. zod 검증 + 활성 팀 스코핑은 기존 `updateFines`/`reorderRotation`과 동일한 방식으로.

### 1. `createFineConfig(year: number): Promise<FinesView>`

연도별 벌금 설정을 **명시 생성**한다(자동 생성 아님). 시그니처:

```ts
export async function createFineConfig(year: number): Promise<FinesView>
```

규칙:
- `requireRole("관리자")` — 관리자만. (실패 시 throw — `updateFines`와 동일하게 처리)
- zod로 `year`(정수) 검증. 실패 시 `HttpError(400, ...)`.
- `getActiveTeam(session.memberId)`로 활성 팀을 얻는다. 없으면 `HttpError(403, ...)`.
- **멱등 생성**: `prisma.fineConfig.upsert({ where: { teamId_year: { teamId, year } }, create: { teamId, year }, update: {} })`. `finePresenter`/`fineAbsent`는 스키마 default(30000/10000)가 적용된다. 이미 있으면 그대로 둔다(중복 생성·덮어쓰기 금지).
- `revalidatePath("/schedule")`.
- `getFines(year, team.id)`를 반환한다(생성 직후이므로 non-null). null이면 `HttpError`로 처리.

### 2. `updateLedger(input): Promise<FinesView>`

멤버 장부(참여·발표자 불참·일반 불참·납부)를 **관리자 수동 편집**으로 저장한다. 시그니처:

```ts
export async function updateLedger(input: {
  year: number;
  rows: Array<{
    memberId: string;
    count: number;
    missedPresenter: number;
    missedAbsent: number;
    paid: number;
  }>;
}): Promise<FinesView>
```

규칙:
- `requireRole("관리자")` — 관리자만.
- zod 검증: `year` 정수, `rows` 배열, 각 행의 `memberId`는 비어있지 않은 문자열, **`count`·`missedPresenter`·`missedAbsent`·`paid`는 모두 정수 ≥ 0**(음수 거부). 실패 시 `HttpError(400, ...)`.
- `getActiveTeam` → 없으면 `HttpError(403, ...)`.
- **신뢰 경계(R3/R37)**: `prisma.membership.findMany({ where: { teamId: team.id } })`로 활성 팀 소속 `memberId` 집합을 만들고, 입력 `rows`에서 **팀 멤버인 행만** 남긴다. 다른 팀/외부 멤버 id는 무시한다(`reorderRotation`과 동일 패턴).
- 남은 각 행을 `prisma.memberLedger.upsert({ where: { teamId_year_memberId: { teamId, year, memberId } }, create: { teamId, year, memberId, count, missedPresenter, missedAbsent, paid }, update: { count, missedPresenter, missedAbsent, paid } })`로 저장한다. 여러 행은 `prisma.$transaction([...])`로 묶는다.
- `revalidatePath("/schedule")`.
- `getFines(year, team.id)`를 반환한다.

CRITICAL — 반드시 지킬 것:
- **`teamId`는 활성 팀에서 주입하고, `memberId`는 membership으로 검증한다(R3/R37).** 클라가 보낸 teamId나 팀 외부 멤버 id를 신뢰하지 마라.
- **누적 벌금·미납을 저장하지 마라.** `count`/`missedPresenter`/`missedAbsent`/`paid` 원자료만 저장한다. 누적/미납은 화면에서 `deriveFineSummary`로 파생한다(DB.md).
- **관리자만**(SECURITY) — `updateFines`와 동일.
- `MemberLedger`는 `FineConfig[teamId, year]`로 FK가 걸려 있다 — 즉 해당 연도 `FineConfig`가 있어야 upsert가 성립한다. UI는 설정이 있을 때만 편집 표를 노출하므로 정상 경로에선 안전하다(별도 방어 코드는 선택).

### 3. 테스트 (먼저 작성 — RED)

`app/(app)/schedule/__tests__/actions.test.ts`에 추가한다. 기존 `prismaMock`(hoisted)에 `fineConfig.upsert`·`memberLedger.upsert`를 추가하고, `$transaction`의 배열 형은 이미 지원됨을 활용한다.

- **createFineConfig**: 관리자일 때 `fineConfig.upsert`가 `where.teamId_year = { teamId: "tA", year }`로 호출되고 `getFines` 결과를 반환한다. 활성 팀이 없으면 throw하고 upsert 미호출.
- **createFineConfig 권한**: `requireRole`이 throw하면(비관리자) 액션이 reject하고 아무것도 쓰지 않는다.
- **updateLedger 신뢰 경계**: membership에 `ha`·`bak`만 있을 때 입력 `rows`에 `jo`(외부)가 섞여 와도 `jo`는 upsert되지 않고 팀 멤버만 `teamId="tA"`로 upsert된다.
- **updateLedger 검증**: 음수 값(예: `paid: -1`)이면 reject하고 아무것도 쓰지 않는다.
- **updateLedger 권한/팀**: 활성 팀이 없으면 throw, upsert 미호출.

## Acceptance Criteria

```bash
npm test        # 추가한 createFineConfig·updateLedger 테스트 통과(RED→GREEN), 기존 테스트 유지
npm run build   # 타입/컴파일 에러 없음
```

## 검증 절차

1. 위 AC 커맨드를 실행한다(둘 다 green).
2. 아키텍처 체크리스트:
   - 쓰기가 Server Action 안에서만 일어나는가(ADR-015/클라 직접 DB 호출 없음)?
   - `teamId` 주입·`memberId` membership 검증이 들어갔는가(ADR-020/R3/R37)?
   - 누적/미납을 저장하지 않았는가(DB.md)?
   - 관리자 게이팅이 `updateFines`와 동일한가(SECURITY)?
3. `phases/11-fines/index.json`의 step 1을 업데이트(`completed` + `summary`). summary에 "createFineConfig(멱등 upsert·기본값) + updateLedger(팀 멤버만 upsert·음수 거부·파생 미저장)·테스트, getFines 반환" 명시.

## 금지사항

- **클라가 보낸 `teamId`/외부 `memberId`를 신뢰하지 마라. 이유: 신뢰 경계 — 서버가 활성 팀·membership에서 결정(R3/R37).**
- **누적 벌금·미납을 DB에 저장하지 마라. 이유: 파생값이다(DB.md). 원자료 4개만 저장한다.**
- **비관리자에게 생성·편집을 허용하지 마라. 이유: SECURITY — `updateFines`와 동일 게이팅.**
- **스키마(`prisma/schema.prisma`)를 바꾸지 마라. 이유: `FineConfig`·`MemberLedger`는 이미 존재한다.**
- **UI(`.tsx`)를 건드리지 마라. 이유: 이 step은 서버 로직만 — UI는 step 2.**
- 기존 테스트를 깨뜨리지 마라.
