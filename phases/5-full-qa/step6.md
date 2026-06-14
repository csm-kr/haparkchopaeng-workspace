# Step 6: team-flow

User Flow **F6. 팀 관리 (관리자)**를 헤드리스 e2e로 QA한다. 대상은 `tests/e2e/team.spec.ts`.

## 읽어야 할 파일

**정본은 루트 `README.md` · `CLAUDE.md` · `PRD.md`. 충돌 시 이를 따른다.**

항상:
- `docs/dev/ARCHITECTURE.md` · `docs/agent/ADR.md`(고치지 말 것) · `docs/dev/CODING_CONVENTION.md`

이 flow 전용:
- `docs/user/USER_FLOW.md` §F6 · `docs/user/USER_JOURNEY.md` "온보딩" · ADR-007(초대 전용, 공개 가입 없음)
- `docs/security/SECURITY.md`(권한 체크) · `app/(app)/team/page.tsx` 와 초대/멤버 컴포넌트
- `app/api/invites/route.ts` 등(형태만 파악 — 호출하지 않음)
- `playwright.config.ts` · `tests/e2e/team.spec.ts`(수정 대상)

## 공통 제약 (모든 flow step 동일)

- **DB는 공유 운영 Supabase다.** e2e는 **비파괴적·데이터 무관**.
- **초대 전송/역할 변경/내보내기를 실제로 실행하지 마라**(공유 DB·실제 이메일·멤버 변경 발생). 폼/메뉴는 **열고·검증까지만.**
- 로그인 `POST /api/auth/login {email:"de8167@gmail.com"}` — de8167은 **관리자**다. step 0이 webServer를 dev로 고쳐 둠.

## 작업

`tests/e2e/team.spec.ts`를 보강한다. 기존 "본인 멤버 + 초대 블록" 테스트는 유지한다.

검증 대상(실제 카피/셀렉터는 코드로 확정):

1. **관리자 초대 블록(기존):** `초대할 이메일` 입력 + `[초대 보내기]` 버튼이 보인다. 역할 선택(관리자/멤버/게스트)과 `[🔗 링크 복사]`도 노출되는지 단언(있으면).
2. **멤버 행 + ⋯ 메뉴(비파괴):** 본인(de8167) 멤버 행의 `[⋯]`을 열면 `역할 변경` / `내보내기` 액션이 보인다. **클릭해 실행하지 말고** 메뉴 노출까지만.
3. **파괴 액션 확인 다이얼로그:** `내보내기`를 누르면(또는 hover/포커스) "OOO님을 내보낼까요?" 류 **확인 다이얼로그**가 뜨는지 검증하되, **확인(실행)을 누르지 말고** 다이얼로그 노출 후 **취소/닫기**로 빠져나온다. 본인을 내보내는 위험을 피하려면 다이얼로그 노출만 단언하고 닫는다.
4. (선택) **권한 안내:** 게스트/비관리자에게 숨겨지거나 "관리자만 할 수 있어요" 류 안내가 있는 영역이 있으면 관리자 시점에서 정상 노출됨을 단언.

## Acceptance Criteria

```bash
npx playwright test tests/e2e/team.spec.ts
```

기대: 실패 0건, 종료 코드 0.

## 검증 절차

1. AC 실행.
2. 체크리스트: 초대 전송/역할 변경/내보내기를 **실제 실행하는 경로가 없는가?** 확인 다이얼로그를 확인(실행)까지 누르지 않는가? 셀렉터가 실제 카피/role과 일치하는가? 전체 spec도 통과하는가?
3. `phases/5-full-qa/index.json` step 6 업데이트(completed+summary / error / blocked).

## 금지사항

- `[초대 보내기]`/`역할 변경`/`내보내기`의 **확정 액션을 누르지 마라.** 이유: 공유 운영 DB의 멤버·초대가 실제로 바뀌고 실제 이메일이 발송될 수 있다.
- 멤버가 여럿이라고 가정하지 마라(단일 관리자일 수 있음). 본인 행 기준으로 데이터-무관하게 단언.
- 기존 통과 spec을 깨뜨리지 마라.
