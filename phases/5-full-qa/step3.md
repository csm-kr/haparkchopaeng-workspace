# Step 3: upload-flow

User Flow **F2. 논문 업로드 → 분석**의 **입력·검증 분기**와 **주간 분석 한도 표시**를 헤드리스 e2e로 QA한다. 대상은 `tests/e2e/upload.spec.ts`.

## 읽어야 할 파일

**정본은 루트 `README.md` · `CLAUDE.md` · `PRD.md`. 충돌 시 이를 따른다.**

항상:
- `docs/dev/ARCHITECTURE.md` · `docs/agent/ADR.md`(고치지 말 것) · `docs/dev/CODING_CONVENTION.md`

이 flow 전용:
- `docs/user/USER_FLOW.md` §F2 · ADR-003(PDF 전용) · `docs/user/PRD.md`(주간 분석 한도)
- 업로드 모달 컴포넌트(`components/` 내 Upload 모달/버튼) · `app/(app)/dashboard/page.tsx`·`library/page.tsx`(UploadButton에 quota props 전달)
- `lib/rate-limit`(quotaStatus → {limit, used, remaining}) — phase-4 step1 산출물
- `playwright.config.ts` · `tests/e2e/upload.spec.ts`(수정 대상)

## 공통 제약 (모든 flow step 동일)

- **DB는 공유 운영 Supabase다.** e2e는 **비파괴적·데이터 무관**.
- **실제 업로드/arXiv 가져오기를 끝까지 실행하지 마라**(논문이 생성되고 분석 잡이 돌아 공유 DB·Inngest·Gemini 비용이 발생). **검증/인라인 에러까지만.**
- 로그인 `POST /api/auth/login {email:"de8167@gmail.com"}`. step 0이 webServer를 dev로 고쳐 둠.

## 작업

`tests/e2e/upload.spec.ts`에 F2의 **클라이언트 검증 분기**를 보강한다. 기존 "비-PDF 거부" 테스트는 유지한다.

검증 대상(실제 카피/셀렉터는 코드로 확정):

1. **모달 열기:** 홈/라이브러리에서 업로드 버튼 클릭 → `role="dialog"` 노출, `arXiv 주소` 입력과 `PDF 파일 선택`이 보인다(ADR-003: PDF 전용 + arXiv).
2. **비-PDF 거부(기존):** `.pptx` 등 비-PDF 첨부 → "PDF만 올릴 수 있어요." 인라인 에러, 모달 유지.
3. **arXiv URL 오류:** 잘못된 arXiv 주소를 입력하고 `[가져오기]` → "arXiv 주소를 확인해주세요" 류 **인라인** 에러(토스트 아님), 모달 유지. 화면 구현이 클라이언트 검증이면 그대로, 서버 호출이 필요하면 **잘못된 입력으로 서버가 생성까지 가지 않는 선**에서만 단언한다.
4. **주간 분석 한도 표시:** 모달(또는 업로드 영역)에 "이번 주 분석 N/20" 류 한도 텍스트가 보인다(phase-4 step1). 정규식 `/이번 주 분석 \d+\/\d+/` 형태로 데이터-무관하게 단언한다.

## Acceptance Criteria

```bash
npx playwright test tests/e2e/upload.spec.ts
```

기대: 실패 0건, 종료 코드 0.

## 검증 절차

1. AC 실행.
2. 체크리스트: 실제 업로드/arXiv import가 끝까지 가는 경로가 없는가? 한도 단언이 특정 수치에 의존하지 않는가(정규식)? 실제 카피/label과 일치하는가? 전체 spec도 통과하는가?
3. `phases/5-full-qa/index.json` step 3 업데이트(completed+summary / error / blocked).

## 금지사항

- 유효한 PDF/arXiv로 **업로드를 완료하지 마라.** 이유: 공유 DB에 논문이 생기고 분석 잡(Inngest+Gemini)이 실제로 돌아 비용·오염 발생.
- 한도 표시를 `20/20`처럼 하드코딩 수치로 단언하지 마라(가변). 정규식으로.
- 기존 통과 spec을 깨뜨리지 마라.
