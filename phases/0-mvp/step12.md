# Step 12: team

팀 관리 화면을 만든다: 이메일+역할 초대 · 초대 링크 복사 · 멤버 목록(역할 변경/내보내기) · 대기 중인 초대(재전송/취소). 관리자 전용 액션은 서버에서 강제(엔드포인트는 step4에 있음).

## 읽어야 할 파일

먼저 아래 문서를 읽고 설계 의도를 파악하라. **정본은 루트 `README.md` · `CLAUDE.md` · `PRD.md`이며, 충돌 시 이를 따른다.**

항상:
- `docs/dev/ARCHITECTURE.md` — §데이터 흐름(읽기 RSC, 쓰기 Server Action/route)
- `docs/agent/ADR.md` — **ADR-007(초대 전용·역할)·ADR-015**. 고치지 말 것.
- `docs/dev/CODING_CONVENTION.md`

이 step(화면 + 팀 쓰기 wiring):
- `docs/design/SCREENS.md` — §team(초대 블록·멤버 행·대기 초대 점선·역할 배지)
- `docs/user/USER_FLOW.md` — **F6(팀 관리)**
- `docs/dev/API.md` — 팀·초대 엔드포인트(👑): invites POST/GET/[id] DELETE/resend, members role/remove
- `docs/security/SECURITY.md` — §인가(👑 관리자 전용), 권한 서버 진입부
- `docs/agent/RULES.md` — R18(초대 전용)·R19(서버 권한)·R27(파괴적 확인)·R20·R26·R29

이전 step 산출물(재사용 — 새 엔드포인트를 만들지 말고 연결):
- `app/(app)/team/page.tsx`(자리표시 → 실제), `app/(app)/layout.tsx`
- `app/api/invites/route.ts`(POST/GET)·`app/api/invites/[id]/route.ts`(DELETE)·`app/api/invites/[id]/resend/route.ts`·`app/api/members/...`(역할 변경/내보내기) — **step4에서 만든 것들. 이미 있으면 그대로 호출**(없는 동작만 Server Action으로 보강).
- `components/ui/*`(Badge·Avatar·Button·Input)·`lib/prisma.ts`·`lib/auth.ts`(`requireRole('관리자')`)
- `types/`(Member·Invite·Role·InviteStatus)
- `app/api/auth/login/route.ts`(E2E), `playwright.config.ts`

## 작업

### 1. 조회 (RSC) — `app/(app)/team/page.tsx`
- `lib/team.ts`(또는 기존 멤버 조회 재사용): 멤버 목록(역할 포함) + 대기 중인 초대 목록. RSC 서버 조회(ADR-015).

### 2. 화면 — `components/team/`
- **초대 블록**: `[이메일][역할 선택 관리자/멤버/게스트][초대 보내기]` + **🔗 초대 링크 복사**(생성된 토큰 링크). 관리자만 보이고/동작(👑).
- **멤버 목록**: 행 = 아바타·이름(+자신에게 "나")·이메일·**역할 배지**(관리자=액센트/멤버=중립/게스트=앰버, 색+텍스트 R29)·`⋯` 메뉴(역할 변경 / **내보내기(위험)**).
  - **내보내기는 확인 다이얼로그**("OOO님을 내보낼까요?", 위험 색, R27). 본인·관리자 보호 정책은 SECURITY를 따른다.
- **대기 중인 초대**(점선 행): 이메일·"초대됨"·[재전송][취소(되돌리기 토스트)].
- 상태 3종(로딩·빈·에러, R26). 비관리자에겐 관리 액션을 숨기거나 비활성+안내("관리자만 할 수 있어요").

### 3. 쓰기 wiring
- 초대 생성/취소/재전송·역할 변경·내보내기는 **기존 route handler 호출** 또는 Server Action. **권한은 서버에서**(👑) 이미 강제됨 — UI는 보조. 변이 후 `revalidatePath`.
- **새 공개 가입 경로를 만들지 마라**(R18).

### 4. E2E (핵심 경로 1개)
- `tests/e2e/team.spec.ts`: dev 로그인(관리자=하수현) → `/team` → 멤버 4인 렌더·역할 배지·초대 블록 표시 확인.

## Acceptance Criteria

```bash
npm run build
npm test                 # vitest run — RTL: 멤버 행·역할 배지·대기 초대·내보내기 확인 다이얼로그·비관리자 액션 숨김/비활성
npm run lint
npx playwright test      # 헤드리스: 로그인→/team 멤버·초대 블록 렌더
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 아키텍처 체크리스트:
   - 관리 액션(초대·역할 변경·내보내기)이 **서버에서 관리자 전용**으로 강제되는가(👑, R19)? 새 공개 가입 경로가 없는가(R18)?
   - **내보내기에 확인**이 있는가(R27)? 역할 배지가 색+텍스트인가(R29)?
   - 읽기=RSC, 쓰기=Server Action/route, 토큰만(ADR-015/R20)? 상태 3종(R26)?
3. 결과에 따라 `phases/0-mvp/index.json`의 step12를 업데이트:
   - 성공 → `"completed"` + `"summary"`
   - 3회 실패 → `"error"` + `"error_message"`
   - 사용자 개입 필요 → `"blocked"` + `"blocked_reason"` 후 중단

## 금지사항

- **새 공개 회원가입/로그인 경로를 만들지 마라.** 초대 전용(R18/ADR-007).
- **관리 액션을 클라이언트 권한 체크에만 의존하지 마라.** 서버 진입부 강제(R19). UI 숨김은 보조.
- **내보내기·초대 취소를 확인/되돌리기 없이 즉시 실행하지 마라**(R27).
- **새 초대/멤버 엔드포인트를 중복 생성하지 마라.** step4의 것을 호출(없는 동작만 보강).
- **클라이언트 DB 직접 조회 금지**(읽기=RSC). **hex 하드코딩·색만 의존 금지**(R20/R29).
- **`test` 워치 모드·E2E 비헤드리스 금지**.
- 기존 테스트를 깨뜨리지 마라.
