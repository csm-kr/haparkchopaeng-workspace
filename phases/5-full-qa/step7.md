# Step 7: global-flow

**전역 인터랙션**(내비게이션·명령 팔레트·검색·로그아웃)을 헤드리스 e2e로 QA하고,
마지막으로 **전체 스위트를 돌려 QA 리포트**를 작성한다. 이 phase의 마무리 step이다.

## 읽어야 할 파일

**정본은 루트 `README.md` · `CLAUDE.md` · `PRD.md`. 충돌 시 이를 따른다.**

항상:
- `docs/dev/ARCHITECTURE.md` · `docs/agent/ADR.md`(고치지 말 것) · `docs/dev/CODING_CONVENTION.md`

이 step 전용:
- `docs/user/USER_FLOW.md` "전역 인터랙션" / "전역 상태·피드백 규칙"
- `app/(app)/layout.tsx`(사이드바·셸) · 명령 팔레트/검색 컴포넌트(`components/` 내) · `app/api/auth/logout/route.ts`
- `playwright.config.ts` · `tests/e2e/` 전체(특히 dashboard·profile spec의 셀렉터 패턴)
- `phases/5-full-qa/` step0~6과 그 산출 spec들(이전 step 요약은 프롬프트 상단 "이전 Step 산출물" 참고)

## 공통 제약 (모든 flow step 동일)

- **DB는 공유 운영 Supabase다.** e2e는 **비파괴적·데이터 무관**.
- 로그아웃은 **세션 쿠키만** 지운다(브라우저 컨텍스트 한정, 공유 DB 불변) → 허용. 그 외 영속 변경 금지.
- 로그인 `POST /api/auth/login {email:"de8167@gmail.com"}`. step 0이 webServer를 dev로 고쳐 둠.

## 작업

### 1) `tests/e2e/global.spec.ts` 신규 작성

검증 대상(실제 카피/role/단축키는 코드로 확정):

1. **사이드바 내비게이션:** 로그인 후 `/dashboard`에서 `role="navigation"`("주요 메뉴") 내 링크로 `library`·`schedule`·`presentations`·`team`·`meeting`·`profile`로 이동 가능. 대표 2~3개 경로를 클릭해 URL/화면 마커로 단언(데이터-무관).
2. **명령 팔레트:** `page.keyboard.press("Control+k")`로 팔레트가 열리고(`role="dialog"` 또는 검색 입력 노출), `Escape`로 닫힌다. 화면에 명령 팔레트가 없으면 이 케이스는 생략하고 주석으로 사유를 남긴다.
3. **검색:** 팔레트/검색 입력에 질의를 입력하면 통합 결과 또는 "결과 없음" 빈 상태가 보인다(데이터-무관 `.or`).
4. **로그아웃:** `/profile`(또는 메뉴)에서 로그아웃 → 보호 라우트(`/dashboard`) 접근 시 로그인/홈으로 리다이렉트되는지 단언.

### 2) 전체 스위트 실행 + 리포트

`tests/e2e/` 전체를 돌려 결과를 집계하고 `phases/5-full-qa/QA_REPORT.md`를 작성한다. 포함 항목:

- 실행 커맨드와 환경(dev 서버, 공유 운영 Supabase, 단일 관리자 de8167).
- spec별 결과 표: 파일 · 대상 User Flow(F1~F6/전역) · passed/skipped · 비고.
- **의도적 미검증(범위 밖)**: 라이브 시작/종료, 스케줄 저장, 업로드 완료, 노트/댓글/초대 생성 — 공유 운영 DB 비파괴 원칙상 실행하지 않음.
- **데이터 의존 조건부**: paper/presentation 상세는 해당 데이터가 있을 때만 검증(없으면 skip).
- 발견된 결함/개선점이 있으면 목록화(없으면 "이번 패스에서 회귀·결함 없음"이라고 명시).

## Acceptance Criteria

```bash
npx playwright test
```

기대: **실패 0건**(데이터에 따라 일부 skipped 가능), 종료 코드 0. 그리고 `phases/5-full-qa/QA_REPORT.md`가 생성돼 있을 것.

## 검증 절차

1. `npx playwright test` 전체 실행 → 실패 0건 확인.
2. `QA_REPORT.md`가 실제 실행 결과(passed/skipped 수)를 반영하는지 확인.
3. 체크리스트: 로그아웃 외 영속 변경 경로가 없는가? 새 spec이 실제 카피/role과 일치하는가? 전역 규칙(USER_FLOW "전역 상태·피드백")을 반영했는가?
4. `phases/5-full-qa/index.json` step 7 업데이트(completed+summary / error / blocked). summary에 전체 passed/skipped 집계를 적는다.

## 금지사항

- 로그아웃 외에 세션/DB를 바꾸는 액션을 넣지 마라. 이유: 공유 운영 DB 비파괴 원칙.
- 화면에 없는 명령 팔레트/검색 UI를 가정해 단언하지 마라. 코드로 확인하고, 없으면 해당 케이스를 생략하고 리포트에 사유를 남긴다.
- 기존 통과 spec을 깨뜨리지 마라.
