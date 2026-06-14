# Step 0: rotation-advance (순번 연속 전진)

## 읽어야 할 파일
정본은 루트 `README.md`·`CLAUDE.md`·`PRD.md`. 충돌 시 이를 따른다.
- `docs/dev/ARCHITECTURE.md` · `docs/agent/ADR.md`(ADR-006 스케줄 라이프사이클, ADR-018 로테이션 iteration) · `docs/dev/CODING_CONVENTION.md`
- `docs/dev/DB.md`(`ScheduleMonth.rotationPointerAfter`) · `docs/dev/API.md`(스케줄·책임)
- `lib/schedule-logic.ts`(`nextPointer`, `draftMonth`, `isBreakWeek`) · `lib/schedule.ts`(`resolveStartIdx`, `getScheduleMembers`)
- `app/(app)/schedule/actions.ts`(`draftMonthAction`, `saveMonth`) · `lib/__tests__/schedule.test.ts`

## 작업
순번 포인터 **연속 전진**을 실제로 연결한다. 지금은 매달 `startIdx=0`으로 시작하고 `saveMonth`가 `rotationPointerAfter=0`을 저장한다. 이미 존재하는 `resolveStartIdx`·`nextPointer`를 재사용해 직전 저장 달에서 이어가도록 한다.

1. `draftMonthAction(year, month)`: `0` → `resolveStartIdx(year, month)`를 시작 인덱스로 사용. rotation은 `getScheduleMembers()`의 id 배열(기존대로).
2. `saveMonth`: `const pointer = 0` 제거. `startIdx = resolveStartIdx(year, month)`, `count =` 저장 weeks 중 **presenterId가 있는 주 수**(방학 제외), `len =` 멤버 수(`getScheduleMembers().length`). `rotationPointerAfter = nextPointer(startIdx, count, len)`.

CRITICAL:
- 멤버 수를 상수로 가정하지 마라(가변). `nextPointer`/`resolveStartIdx`는 이미 있다 — 새로 만들지 말고 재사용.
- 포인터는 **서버가 계산**한다. 클라이언트가 보낸 포인터를 신뢰하지 마라(R16).

## Acceptance Criteria
```bash
npm test        # lib/__tests__/schedule.test.ts에 연속 전진 케이스 추가(직전 달 pointer 이어받기)
npm run build   # 타입/컴파일 에러 없음
```

## 금지사항
- 빈 달을 자동 생성하지 마라. 이유: row 부재 = 빈 달(ADR-006).
- 낙관적 락(`version`) 로직을 바꾸지 마라. 이유: 동시 편집 충돌 보호(R35) — 이번 step 범위 밖.
