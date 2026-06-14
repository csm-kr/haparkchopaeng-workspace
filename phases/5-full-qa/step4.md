# Step 4: paper-flow

User Flow **F3. 논문 분석 읽기·노트 작성**을 헤드리스 e2e로 QA한다. 대상은 `tests/e2e/paper.spec.ts`로,
현재 `test.skip(...)` 상태다. 이걸 **데이터-무관 조건부 테스트**로 되살린다.

## 읽어야 할 파일

**정본은 루트 `README.md` · `CLAUDE.md` · `PRD.md`. 충돌 시 이를 따른다.**

항상:
- `docs/dev/ARCHITECTURE.md` · `docs/agent/ADR.md`(고치지 말 것) · `docs/dev/CODING_CONVENTION.md`

이 flow 전용:
- `docs/user/USER_FLOW.md` §F3 · ADR-005(노트 스코프, Figure 노트만 관점 공통)
- `app/(app)/papers/[id]/page.tsx` 와 관점 토글·Figure·섹션 노트 컴포넌트(`components/`)
- `app/(app)/library/page.tsx`(목록에서 `.paper-row` 셀렉터) · `tests/e2e/library.spec.ts`(참고)
- `playwright.config.ts` · `tests/e2e/paper.spec.ts`(수정 대상)

## 공통 제약 (모든 flow step 동일)

- **DB는 공유 운영 Supabase다.** e2e는 **비파괴적·데이터 무관**.
- 논문 상세는 **논문 존재가 전제**다. 공유 DB라 논문 수는 가변 → **존재하면 검증, 없으면 런타임 skip**.
- **노트를 실제로 추가하지 마라**(공유 DB에 노트가 생긴다). 폼은 **열고·취소까지만.**
- 로그인 `POST /api/auth/login {email:"de8167@gmail.com"}`. step 0이 webServer를 dev로 고쳐 둠.

## 작업

`tests/e2e/paper.spec.ts`의 `test.skip(...)`을 **조건부 실 테스트**로 교체한다.

구조(실제 카피/셀렉터는 코드로 확정):

1. 로그인 → `/library` 진입.
2. `const rows = page.locator("a.paper-row")` 의 개수를 센다. `await rows.count() === 0` 이면
   `test.skip(true, "공유 DB에 논문이 없어 상세 검증 보류")` 로 **런타임 skip**(실패가 아니다).
3. 논문이 있으면 `rows.first().click()` → `/papers/:id` 상세 진입.
4. **관점 토글 검증:** 상단 고정 토글에 `연구 분석`/`재구현 분석`(또는 🔬/🛠️)이 보인다. `재구현 분석`으로 토글하면 재구현 섹션(데이터·모델·학습·리소스 중 하나)이 보이고, `연구 분석`으로 되돌리면 연구 섹션(Problem/Contribution 등)이 보인다.
5. **Figure 공통 노출:** 두 관점 어디서나 하단에 `Figure 분석`(또는 "PDF p.N 추출" 배지)이 존재한다(ADR-005: lens "any"). 단, 그 논문에 figure가 없을 수 있으니 **섹션 헤더 존재**만 단언하거나 `.or(빈 figure 상태)`로 데이터-무관하게 한다.
6. **섹션 노트 폼(비파괴):** `[+ 이 섹션에 분석 추가]` 클릭 → 인라인 폼(제목+본문) 노출 → `[취소]` → 폼 닫힘. **`[추가]`를 누르지 마라.**

## Acceptance Criteria

```bash
npx playwright test tests/e2e/paper.spec.ts
```

기대: 논문이 있으면 통과, 없으면 1 skipped. 어느 경우도 **실패 0건**, 종료 코드 0.

## 검증 절차

1. AC 실행. (논문 유무 두 경우 모두 실패가 아니어야 한다.)
2. 체크리스트: 노트를 실제 추가하는 경로가 없는가? figure/노트 단언이 특정 데이터에 의존하지 않는가? 관점 토글 카피/role이 실제와 일치하는가?
3. `phases/5-full-qa/index.json` step 4 업데이트(completed+summary / error / blocked). skip이어도 spec이 실패 없이 끝나면 completed로 본다(summary에 "논문 유무 조건부"라고 명시).

## 금지사항

- 섹션 노트 폼에서 **`[추가]`(제출)를 누르지 마라.** 이유: 공유 운영 DB에 노트가 영구 생성된다.
- 논문이 반드시 있다고 가정하지 마라. 없으면 런타임 `test.skip`으로 처리(테스트 실패로 만들지 말 것).
- 기존 통과 spec을 깨뜨리지 마라.
