# Step 2: schedule-flow

User Flow **F4. 스케줄: 빈 달 → 편집 → 확정**을 헤드리스 e2e로 깊게 QA한다. 대상은 `tests/e2e/schedule.spec.ts`.

## 읽어야 할 파일

**정본은 루트 `README.md` · `CLAUDE.md` · `PRD.md`. 충돌 시 이를 따른다.**

항상:
- `docs/dev/ARCHITECTURE.md` · `docs/agent/ADR.md`(고치지 말 것) · `docs/dev/CODING_CONVENTION.md`

이 flow 전용:
- `docs/user/USER_FLOW.md` §F4 · `docs/user/USER_JOURNEY.md` "월간 일정 편성" · ADR-006(빈 달은 자동 생성 안 함)
- `app/(app)/schedule/page.tsx` 와 schedule 화면 컴포넌트
- `app/api/...`(schedule/month 영속 관련 액션이 있다면 형태만 파악)
- `playwright.config.ts` · `tests/e2e/schedule.spec.ts`(수정 대상)

## 공통 제약 (모든 flow step 동일)

- **DB는 공유 운영 Supabase다.** e2e는 **비파괴적·데이터 무관**.
- **영속 변경 금지:** 특히 편집 모드에서 **`[저장]`을 누르지 마라**(월이 영속화되고 순번 포인터가 전진해 공유 DB가 변한다).
- 데이터 가변 가정. 로그인은 `POST /api/auth/login {email:"de8167@gmail.com"}`.
- step 0이 webServer를 dev로 고쳐 둠.

## 작업

`tests/e2e/schedule.spec.ts`에 F4의 **비파괴적 분기**를 보강한다. 기존 "빈 달 → [일정 짜기] → 편집 모드" 테스트는 유지한다.

검증 대상(실제 카피/셀렉터는 코드로 확정):

1. **빈 달(시드 없는 월, 예: `?y=2026&m=9`)**: "이 달은 아직 일정이 없어요" 빈 상태 + `[일정 짜기]`.
2. **편집 모드 진입:** `[일정 짜기]` 클릭 → 초안 생성 → `[저장]` 바 + `확정 N/M` + 주차 발표자 select 노출(편집 모드 마커).
3. **취소로 초안 폐기(비파괴):** 편집 모드에서 `[취소]`를 누르면 초안이 사라지고 다시 빈 상태로 돌아온다.
4. (가능하면) **편집 중 달 이동 잠금:** 편집 모드에서 이전/다음 달 이동을 시도하면 토스트 경고가 뜨고 달이 바뀌지 않는다. 화면에 해당 UI가 없으면 생략한다.

`[저장]`은 **절대 클릭하지 않는다.** 초안 생성(`draftMonth`)은 클라이언트 상태일 뿐 영속이 아니므로 허용된다 — 단, 코드를 읽어 `[일정 짜기]`가 즉시 서버에 쓰지 않는지(클라 초안인지) 확인하고, **서버에 즉시 쓰는 구조라면 그 클릭도 하지 말고** 빈 상태/CTA 노출까지만 검증한다.

## Acceptance Criteria

```bash
npx playwright test tests/e2e/schedule.spec.ts
```

기대: 실패 0건, 종료 코드 0.

## 검증 절차

1. AC 실행.
2. 체크리스트: `[저장]`을 누르는 경로가 없는가? `[일정 짜기]`가 영속 쓰기를 유발하지 않음을 코드로 확인했는가? 실제 카피/role/label과 일치하는가? 전체 spec도 여전히 통과하는가?
3. `phases/5-full-qa/index.json` step 2 업데이트(성공→completed+summary / 실패→error / 막힘→blocked).

## 금지사항

- 편집 모드에서 **`[저장]`을 누르지 마라.** 이유: 월 영속화 + 순번 포인터 전진으로 공유 운영 DB가 변한다(F4 ※, phase-4 step0 로직).
- `[일정 짜기]`가 서버 즉시 쓰기라면 그것도 누르지 마라. 코드로 먼저 확인할 것.
- ADR-006(빈 달 자동 생성 금지)을 위반하는 단언을 만들지 마라.
- 기존 통과 spec을 깨뜨리지 마라.
