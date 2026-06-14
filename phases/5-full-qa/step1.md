# Step 1: live-flow

User Flow **F1. 라이브 세미나 입장·진행**을 헤드리스 e2e로 깊게 QA한다. 대상 파일은 `tests/e2e/meeting.spec.ts`.

## 읽어야 할 파일

먼저 아래를 읽고 설계 의도를 파악하라. **정본은 루트 `README.md` · `CLAUDE.md` · `PRD.md`이며, 충돌 시 이를 따른다.**

항상:
- `docs/dev/ARCHITECTURE.md` · `docs/agent/ADR.md`(고치지 말 것) · `docs/dev/CODING_CONVENTION.md`

이 flow 전용:
- `docs/user/USER_FLOW.md` §F1 · `docs/user/USER_JOURNEY.md` "토요일 10:00 — 라이브"
- `docs/design/SCREEN_FLOW.md` · `docs/design/SCREENS.md` (meeting 화면)
- `app/(app)/meeting/page.tsx` 와 그 화면 컴포넌트(`components/` 내 meeting/live 관련)
- `playwright.config.ts` · `tests/e2e/meeting.spec.ts`(수정 대상) · `tests/e2e/schedule.spec.ts`(셀렉터 참고)

## 공통 제약 (모든 flow step 동일 — 반드시 지킬 것)

- **DB는 공유 운영 Supabase다(로컬 dev.db 없음).** e2e는 **비파괴적·데이터 무관**이어야 한다.
- **영속 변경을 일으키는 액션을 절대 실행하지 마라:** 라이브 시작/종료, 스케줄 저장, 초대 전송, 논문·발표·노트·댓글 생성. 폼/모달은 **열고·검증하고·취소(또는 그냥 닫기)까지만.**
- 데이터 존재 여부에 의존하지 마라. 가변일 수 있는 화면은 `locator(...).first().or(getByText("빈 상태"))` 패턴으로 단언한다.
- 로그인은 `await page.request.post("/api/auth/login", { data: { email: "de8167@gmail.com" } })` → `expect(login.ok()).toBeTruthy()`.
- step 0이 `playwright.config.ts`를 dev 서버 기동으로 고쳐 두었다. 그 위에서 동작한다.

## 작업

`tests/e2e/meeting.spec.ts`에 F1의 **비파괴적 분기**를 추가한다(기존 빈 상태 테스트는 유지하거나 보강).

검증 대상(실제 화면 카피/셀렉터는 코드를 읽고 확정):

1. **빈 상태(live === false):** "진행 중인 세미나가 없어요" 류 빈 상태 + 두 CTA 노출 — `[라이브 시작하기]`(또는 `/라이브 시작/`) **그리고** `[스케줄 보기]`.
2. **비파괴적 내비 분기:** `[스케줄 보기]`를 클릭하면 `/schedule`로 이동한다(URL 또는 schedule 화면 마커로 단언). 이건 글로벌 상태를 바꾸지 않는다.
3. `[라이브 시작하기]`는 **노출/활성 여부만** 단언하고 **클릭하지 마라**(클릭하면 전역 live가 켜져 공유 DB가 변한다).

스펙은 1~3개의 `test(...)`로 명확히 나눠 작성하고, 각 단언 위에 **왜 이걸 검증하는지** 한국어 주석을 단다(기존 스펙 스타일과 일치).

## Acceptance Criteria

```bash
npx playwright test tests/e2e/meeting.spec.ts
```

기대: 해당 spec 전부 통과(실패 0건), 종료 코드 0.

## 검증 절차

1. 위 AC 실행.
2. 체크리스트: 화면의 실제 카피/role/label에 맞는 셀렉터인가? 글로벌 상태를 바꾸는 클릭이 없는가? 기존 다른 spec을 깨지 않았는가(`npx playwright test`로 전체도 한 번 확인 권장)?
3. `phases/5-full-qa/index.json` step 1 업데이트:
   - 성공 → `"completed"` + `"summary"`(추가한 케이스 요약)
   - 3회 실패 → `"error"` + `"error_message"`
   - 화면 카피/요소가 문서와 달라 단언 불가 등 막힘 → 데이터-무관하게 우회하거나, 정말 불가하면 `"blocked"` + 사유

## 금지사항

- `[라이브 시작하기]`/`[종료]`를 **클릭하지 마라.** 이유: 전역 `live`가 켜지면 모든 사용자에게 배너·배지가 뜨고 공유 운영 DB가 오염된다.
- 화면에 없는 요소를 가정해 단언하지 마라. **반드시 `meeting/page.tsx`와 컴포넌트를 읽고** 실제 텍스트/role/label로 셀렉터를 만든다.
- 기존 통과 spec을 깨뜨리지 마라.
