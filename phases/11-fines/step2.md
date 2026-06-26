# Step 2: fines-panel-edit

벌금 패널에 **설정 생성 버튼**과 **멤버 현황 표 편집(표 전체 편집 모드)**을 붙이고, schedule 페이지에 배선한다. **TDD**: 컴포넌트 테스트를 먼저 쓰고(RED) 통과시킨다(GREEN).

이 step은 **UI 레이어 + RSC 배선**을 다룬다. 서버 액션은 step 1에서 이미 만들어졌다.

## 읽어야 할 파일

먼저 아래를 읽고 설계 의도를 파악하라. **정본은 루트 `README.md` · `CLAUDE.md`와 제품 정의 `docs/user/PRD.md`이며, 충돌 시 이를 따른다.**

항상:
- `docs/dev/ARCHITECTURE.md` — 스택·디렉토리 구조
- `docs/agent/ADR.md` — 결정 근거 (특히 ADR-015 RSC 읽기·Server Action 쓰기, ADR-020 팀 스코핑, step 0이 추가한 **벌금 장부 수동 편집·설정 명시 생성·관리자 전용 ADR**)
- `docs/dev/CODING_CONVENTION.md` — 코드 규칙
- `docs/design/DESIGN_GUIDE.md` · `docs/design/SCREENS.md`(step 0이 보강한 벌금 설정 시작 버튼 + 멤버 현황 수정/저장 토글) — 화면 명세
- `docs/security/SECURITY.md` — 관리자 전용 UI 게이팅(R19)

이전 step / 현재 코드(읽고 패턴을 그대로 따를 것):
- `components/schedule/fines-panel.tsx` — **이 파일을 확장한다.** 기존 "벌금 설정" 카드의 수정/저장 토글·낙관적 `setFines` 패턴을 멤버 현황 표에도 그대로 적용하라.
- `components/schedule/types.ts` — 입력 DTO 추가 위치.
- `components/schedule/index.ts` — 새 타입 export.
- `components/schedule/__tests__/schedule.test.tsx` — **이 파일에 테스트를 추가한다.** 기존 `FinesPanel` 렌더·이벤트 패턴(RTL `fireEvent`/`waitFor`)을 재사용하라.
- `app/(app)/schedule/page.tsx` — `FinesPanel`을 렌더하는 RSC. 새 props를 배선한다.
- `app/(app)/schedule/actions.ts` — step 1의 `createFineConfig`·`updateLedger`(배선 대상).

## 작업

### 1. `components/schedule/types.ts` — 입력 DTO

장부 편집 입력 타입을 추가하고 `index.ts`에서 export한다:

```ts
export interface LedgerRowInput {
  memberId: string;
  count: number;
  missedPresenter: number;
  missedAbsent: number;
  paid: number;
}
```

### 2. `components/schedule/fines-panel.tsx` — 생성 버튼 + 표 편집

`FinesPanelProps`를 확장한다:
- 기존 `fines`·`isAdmin`·`onUpdate` 유지.
- **`year: number` 추가** — `fines === null`일 때도 어느 해를 생성할지 알아야 한다(지금은 `fines.year`에서만 연도를 얻어 null이면 알 수 없다).
- `onCreate: (year: number) => Promise<FinesView>` 추가.
- `onUpdateLedger: (input: { year: number; rows: LedgerRowInput[] }) => Promise<FinesView>` 추가.

동작:
- **설정이 없을 때(`fines === null`)**:
  - 관리자: "벌금 설정 시작" 버튼을 노출한다 → `onCreate(year)` 호출 → 반환된 `FinesView`로 `setFines` → 설정 카드 + 멤버 현황 표(전부 0)가 즉시 나타난다.
  - 비관리자: 기존 안내문("이 해의 벌금 설정이 아직 없어요") 유지. 버튼 미노출.
- **연도별 멤버 현황 표(관리자)**: 표 제목 줄에 "수정/저장" 토글을 둔다(금액 설정 카드의 토글과 동일 패턴, **표 전체 편집 모드**).
  - 수정 모드: **참여·발표자 불참·일반 불참·납부** 칸을 숫자 입력(`type="number"` `min={0}`)으로 바꾼다. 로컬 편집 상태에 각 멤버의 4개 값을 들고 있는다.
  - "저장": 모든 행을 `onUpdateLedger({ year, rows })`로 보낸다 → 반환 `FinesView`로 `setFines` → 표 즉시 재계산. "취소"는 편집 폐기.
  - **누적 벌금·미납 칸은 파생값이라 편집 불가**(읽기 전용 유지) — 입력으로 만들지 마라. 표시 값은 계속 `deriveFineSummary`로 계산한다.
  - 비관리자: "수정" 토글 미노출(기존 금액 수정과 동일 게이팅).
- 저장 실패 시 기존처럼 인라인 에러 문구(role="alert")로 안내(R26/R30). 비관리자에게 보이는 표는 읽기 전용 그대로.

### 3. `app/(app)/schedule/page.tsx` — 배선

`FinesPanel`에 새 props를 전달한다:
- `year={year}` (이미 page가 계산하는 `year`)
- `onCreate={createFineConfig}` (`./actions`에서 import)
- `onUpdateLedger={updateLedger}` (`./actions`에서 import)

기존 `fines`·`isAdmin`·`onUpdate={updateFines}`는 유지한다.

### 4. 테스트 (먼저 작성 — RED)

`components/schedule/__tests__/schedule.test.tsx`에 `FinesPanel` 케이스를 추가한다. 새 props(`year`·`onCreate`·`onUpdateLedger`)를 넘기는 헬퍼를 만든다.

- **비관리자 + 설정 없음**: "벌금 설정 시작" 버튼이 보이지 않는다(안내문만).
- **관리자 + 설정 없음**: "벌금 설정 시작"이 보이고, 클릭하면 `onCreate`가 `year`로 호출된다. (`onCreate`는 빈 멤버 현황의 `FinesView`를 resolve하도록 mock)
- **비관리자 + 설정 있음**: 멤버 현황 표에 "수정" 토글이 없다(읽기 전용).
- **관리자 + 설정 있음**: "수정" 클릭 → 참여/불참/납부가 숫자 입력으로 바뀐다 → 한 값을 바꾸고 "저장" → `onUpdateLedger`가 `{ year, rows }`로 호출되고 rows에 바뀐 값이 담긴다.

## Acceptance Criteria

```bash
npm test                 # 추가한 FinesPanel 컴포넌트 테스트 통과(RED→GREEN), 기존 테스트 유지
npm run build            # 타입/컴파일 에러 없음
npm run lint             # 규칙 위반 없음
```

## 검증 절차

1. 위 AC 커맨드를 실행한다(모두 green).
2. 아키텍처/디자인 체크리스트:
   - 읽기는 RSC props, 쓰기는 Server Action 호출만인가(ADR-015)? 클라가 DB를 직접 부르지 않는가?
   - 편집/생성 UI가 관리자에게만 노출되는가(R19/SECURITY)?
   - 누적 벌금·미납을 입력으로 만들지 않았는가(파생, DB.md)?
   - 클라가 `teamId`를 만들지 않고 `year`만 보내는가(R3 — 서버가 활성 팀 주입)?
   - DESIGN_GUIDE/SCREENS의 토글·버튼 명세와 일관되는가?
3. `phases/11-fines/index.json`의 step 2를 업데이트(`completed` + `summary`). summary에 "FinesPanel 설정 시작 버튼(null+관리자) + 멤버 현황 표 전체 편집 모드(참여·불참·납부, 누적/미납 읽기전용) + page 배선(year·onCreate·onUpdateLedger)·RTL" 명시.

## 금지사항

- **누적 벌금·미납을 편집 입력으로 만들지 마라. 이유: 파생값이다(DB.md). 원자료 4개(참여·발표자 불참·일반 불참·납부)만 편집한다.**
- **비관리자에게 생성·편집 UI를 노출하지 마라. 이유: SECURITY/R19 — 기존 금액 수정과 동일 게이팅.**
- **클라이언트에서 `teamId`를 만들거나 보내지 마라. 이유: 신뢰 경계 — Server Action이 활성 팀에서 주입한다(R3). `year`만 보낸다.**
- **schedule에 새 Playwright E2E를 추가하지 마라. 이유: 공유 운영 DB라 데이터 가변·플레이크 위험 — 이 기능은 단위/컴포넌트 테스트로 검증한다.**
- 기존 테스트를 깨뜨리지 마라.
