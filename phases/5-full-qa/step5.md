# Step 5: presentation-flow

User Flow **F5. 발표 자료 회고**를 헤드리스 e2e로 QA한다. 대상은 `tests/e2e/presentation.spec.ts`.
현재는 목록 렌더 스모크만 있다 — 상세 뷰어·댓글 입력을 **데이터-무관 조건부**로 보강한다.

## 읽어야 할 파일

**정본은 루트 `README.md` · `CLAUDE.md` · `PRD.md`. 충돌 시 이를 따른다.**

항상:
- `docs/dev/ARCHITECTURE.md` · `docs/agent/ADR.md`(고치지 말 것) · `docs/dev/CODING_CONVENTION.md`

이 flow 전용:
- `docs/user/USER_FLOW.md` §F5 · `docs/user/USER_JOURNEY.md` "회고와 다음 준비"
- `app/(app)/presentations/page.tsx` · `app/(app)/presentations/[id]/page.tsx` 와 뷰어·댓글 컴포넌트
- `playwright.config.ts` · `tests/e2e/presentation.spec.ts`(수정 대상)

## 공통 제약 (모든 flow step 동일)

- **DB는 공유 운영 Supabase다.** e2e는 **비파괴적·데이터 무관**.
- 상세는 발표 자료 존재가 전제 → **있으면 검증, 없으면 런타임 skip**.
- **댓글을 실제로 전송하지 마라**(공유 DB에 댓글이 생긴다). textarea **노출·입력까지만**, 전송(Cmd/Ctrl+Enter, 전송 버튼) **금지**.
- 로그인 `POST /api/auth/login {email:"de8167@gmail.com"}`. step 0이 webServer를 dev로 고쳐 둠.

## 작업

`tests/e2e/presentation.spec.ts`를 보강한다. 기존 "목록 또는 빈 상태" 스모크는 유지한다.

구조(실제 카피/셀렉터는 코드로 확정):

1. 로그인 → `/presentations`. 기존대로 `a.presentation-row` 또는 빈 상태 단언(유지).
2. **조건부 상세 검증:** `const rows = page.locator("a.presentation-row")`. `await rows.count() === 0` 이면 `test.skip(true, "공유 DB에 발표 자료 없음")`.
3. 있으면 `rows.first().click()` → `/presentations/:id` 상세 진입 → **자료 뷰어 영역**과 **댓글 스레드/입력 textarea**가 보인다.
4. 댓글 textarea에 텍스트를 **입력만** 하고(예: `fill("리뷰 테스트")`), **전송하지 않는다**(전송 키/버튼 미클릭). 입력값이 반영되는지(`toHaveValue`)까지만 단언한다.

## Acceptance Criteria

```bash
npx playwright test tests/e2e/presentation.spec.ts
```

기대: 자료가 있으면 통과, 없으면 1 skipped. **실패 0건**, 종료 코드 0.

## 검증 절차

1. AC 실행(자료 유무 두 경우 모두 실패 아님).
2. 체크리스트: 댓글 전송 경로가 없는가? 셀렉터가 실제 카피/role과 일치하는가? 전체 spec도 통과하는가?
3. `phases/5-full-qa/index.json` step 5 업데이트(completed+summary / error / blocked).

## 금지사항

- 댓글을 **전송하지 마라**(Cmd/Ctrl+Enter·전송 버튼). 이유: 공유 운영 DB에 댓글이 영구 생성된다.
- 발표 자료가 반드시 있다고 가정하지 마라. 없으면 런타임 skip.
- 기존 통과 spec을 깨뜨리지 마라.
