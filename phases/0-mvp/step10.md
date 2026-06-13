# Step 10: schedule

스케줄 화면을 만든다 — 두 번째로 중요한 화면. **월별 빈/편집/확정 3상태**, 순번 자동 채움 금지, 편집→저장(순번 전진+낙관적 락)→확정 라이프사이클, 벌금 설정 + 연도별 멤버 장부.

## 읽어야 할 파일

먼저 아래 문서를 읽고 설계 의도를 파악하라. **정본은 루트 `README.md` · `CLAUDE.md` · `PRD.md`이며, 충돌 시 이를 따른다.**

항상:
- `docs/dev/ARCHITECTURE.md` — §데이터 흐름(읽기 RSC, 쓰기 Server Action/route)·동시성(낙관적 락)
- `docs/agent/ADR.md` — **ADR-006(자동생성 금지·편집/확정 분리)·ADR-015·ADR-016(낙관적 락 맥락)**. 고치지 말 것.
- `docs/dev/CODING_CONVENTION.md`

이 step(화면 + 스케줄 쓰기):
- `docs/design/SCREENS.md` — §schedule(보드·벌금·로테이션·연도별 현황) + §화면별 상태
- `docs/design/SCREEN_FLOW.md` — §schedule 상태 머신(빈→편집→확정·취소 확인·저장 에러·휴가)
- `docs/user/USER_FLOW.md` — **F4(빈 달→편집→확정)** 분기·규칙
- `docs/dev/DB.md` — `ScheduleMonth`(+`version`)·`ScheduleWeek`·`FineConfig`·`MemberLedger`. 파생(누적 벌금·미납·current 주차).
- `docs/dev/API.md` — 스케줄/벌금 엔드포인트(GET/draft/PUT If-Match, fines PUT 👑)
- `docs/agent/RULES.md` — **R15(자동생성 금지)·R16(편집/확정 분리·저장 시 순번 전진)·R35(낙관적 락)·R27(취소 확인)·R20·R26·R32**

이전 step 산출물(재사용):
- `app/(app)/schedule/page.tsx`(자리표시 → 실제), `app/(app)/layout.tsx`
- `components/ui/*`·`lib/prisma.ts`·`lib/auth.ts`(`requireRole('관리자')` 벌금 수정)
- `lib/papers.ts`/`lib/dashboard.ts`(서버 조회 패턴 일관), `types/`(ScheduleMonth·ScheduleWeek·WeekStatus·FineConfig·MemberLedger·MemberFineSummary)
- `app/api/auth/login/route.ts`(E2E), `playwright.config.ts`

## 작업

### 1. 조회 (RSC) — `lib/schedule.ts`
- `getMonth(year, month)`: `ScheduleMonth`(+weeks, +version) 또는 **`null`(빈 달)**. **GET이 row를 만들지 않는다**(R15/ADR-006).
- `getFines(year)`: `FineConfig` + 멤버 장부 + **파생**(누적 벌금=`missedPresenter*finePresenter+missedAbsent*fineAbsent`, 미납=`누적-paid`). 저장 안 함.

### 2. 쓰기 — Server Action / route handler
- `draftMonth(year, month, startIdx)`: 해당 월 토요일 계산 + `startIdx`부터 순번 발표자 배정, 주제 빈 값·`confirmed:false`. **DB 저장 안 함(초안)**.
- `saveMonth(year, month, weeks, version)`: 영속화 + **순번 포인터 전진**(`rotationPointerAfter`, 서버에서 원자적) + **낙관적 락**(전달 `version` ≠ 현재면 `409` "다른 사람이 먼저 저장했어요", R35). 변이 후 `revalidatePath`.
- `updateFines(year, {finePresenter, fineAbsent})`: **관리자만**(`requireRole`, 👑). 장부 표가 즉시 재계산되도록.

### 3. 화면 — `components/schedule/`
- **월 보드 3상태**(SCREEN_FLOW §schedule):
  - **빈**(weeks==null): `EmptyState` "이 달은 아직 일정이 없어요" + [일정 짜기] → draft → 편집.
  - **편집**(클라이언트 섬): 행마다 [✓확정][시간][발표자▾][주제____]. 고정 바 "확정 N/M" + [취소][저장]. **편집 중 월 이동 잠김**(토스트). [취소]는 변경분 있으면 확인(R27). 저장 에러 시 입력 보존.
  - **확정**(읽기전용): 주차·날짜·시간·발표자 + 상태 알약(done=완료·current=●이번 주·upcoming=발표예정) + 액션(자료/입장/미리보기) + [수정]. `current`=첫 비-done 주차(파생).
- **벌금 설정**: finePresenter/fineAbsent 보기/편집(관리자). 저장 시 장부 즉시 반영.
- **로테이션**: 하수현→박진희→조성민→팽진욱.
- **연도별 멤버 현황 표**: 참여·발표자 불참·일반 불참·누적 벌금·납부·미납(파생).
- 상태 3종: 로딩 스켈레톤·빈·에러(R26). 발표자 휴가(availability=vacation) 표시(SCREEN_FLOW).

### 4. E2E (핵심 경로 1개)
- `tests/e2e/schedule.spec.ts`: dev 로그인 → `/schedule` → 계획 없는 달이면 빈 상태+[일정 짜기] 확인, [일정 짜기] → 편집 모드(행·저장 바) 진입 확인. (6월은 시드가 있으니 빈 달로 이동해 검증)

## Acceptance Criteria

```bash
npm run build
npm test                 # vitest run — RTL/단위: 빈/편집/확정 상태, draftMonth 순번 배정, 누적벌금·미납 파생, 저장 시 version 불일치 409
npm run lint
npx playwright test      # 헤드리스: 로그인→/schedule→빈 달 [일정 짜기]→편집 진입
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 아키텍처 체크리스트:
   - **빈 달이 자동 생성되지 않는가**(GET이 row 미생성, 월 이동 자동채움 없음 — R15/ADR-006)?
   - 편집/확정이 분리되고 **저장 시에만** 순번 포인터가 서버에서 전진하는가(R16)?
   - 저장이 **낙관적 락**(version 불일치 409)을 쓰는가(R35)?
   - 누적 벌금·미납·current가 **파생**(저장 안 함)인가? 벌금 수정이 관리자 전용인가(👑)?
   - 읽기=RSC, 쓰기=Server Action/route, 토큰만(ADR-015/R20)?
3. 결과에 따라 `phases/0-mvp/index.json`의 step10을 업데이트:
   - 성공 → `"completed"` + `"summary"`
   - 3회 실패 → `"error"` + `"error_message"`
   - 사용자 개입 필요 → `"blocked"` + `"blocked_reason"` 후 중단

## 금지사항

- **빈 달을 자동 생성하지 마라.** GET·월 이동이 `ScheduleMonth`를 만들지 않는다. 빈 달은 비어 있는 그대로(R15/ADR-006).
- **편집과 확정을 한 모드로 합치지 마라.** 명시적 분리, 저장 시에만 영속화+순번 전진(R16).
- **순번 포인터를 클라이언트가 보내지 마라.** 서버에서 원자적으로 전진(R16).
- **저장에 낙관적 락을 빼먹지 마라.** version 불일치 시 409(R35).
- **누적 벌금·미납·current를 저장 필드로 만들지 마라.** 파생값(DB.md).
- **벌금 금액 수정을 비관리자에게 허용하지 마라**(👑, SECURITY).
- **클라이언트 DB 직접 조회·자체 API fetch 금지**(읽기=RSC). **hex 하드코딩·색만 의존 금지**(R20/R29).
- **`test` 워치 모드·E2E 비헤드리스 금지**.
- 기존 테스트를 깨뜨리지 마라.
