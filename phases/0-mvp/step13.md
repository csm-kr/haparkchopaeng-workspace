# Step 13: settings

설정/프로필 화면을 만든다: 프로필 필드 · 알림 토글 · 테마(라이트/다크) · 법적 링크. 프로필 수정은 기존 `PATCH /api/me`로 연결.

## 읽어야 할 파일

먼저 아래 문서를 읽고 설계 의도를 파악하라. **정본은 루트 `README.md` · `CLAUDE.md` · `PRD.md`이며, 충돌 시 이를 따른다.**

항상:
- `docs/dev/ARCHITECTURE.md` — §데이터 흐름(읽기 RSC, 쓰기 Server Action/route)
- `docs/agent/ADR.md` — ADR-015·ADR-017(인증). 고치지 말 것.
- `docs/dev/CODING_CONVENTION.md`

이 step(화면 + 프로필 쓰기 wiring):
- `docs/design/SCREENS.md` — §profile(프로필·알림·테마·법적 링크) + §화면별 상태
- `docs/design/DESIGN_GUIDE.md` — 토큰·테마(`[data-theme]`)·§UX 패턴
- `docs/agent/ISSUES.md` — I-5(알림 채널 미결: 인앱 기본)
- `docs/agent/RULES.md` — R3·R20·R26·R29·R32

이전 step 산출물(재사용 — 새 엔드포인트 만들지 말 것):
- `app/(app)/profile/page.tsx`(자리표시 → 실제), `app/(app)/layout.tsx`
- `app/api/me/route.ts`(GET/PATCH — step4. 프로필 수정에 사용)
- `components/providers/*`(ThemeProvider — 테마 토글 재사용), `components/ui/*`, `lib/auth.ts`(getSession), `lib/prisma.ts`
- `components/legal/*` 또는 LegalModal(있으면 재사용; 없으면 약관/개인정보 정적 페이지)

## 작업

### 1. 조회 (RSC) — `app/(app)/profile/page.tsx`
- `getSession`/`lib`로 현재 멤버 조회(이름·핸들·이메일·역할·상태). RSC(ADR-015).

### 2. 화면 — `components/settings/`
- **프로필**: 이름·핸들·상태(`status`) 편집 + 이메일·역할(읽기 전용 표시). 저장 → `PATCH /api/me`(작성자=세션, R3). 인라인 검증·저장 성공 토스트.
- **알림 토글**: 인앱 알림 on/off 등(채널은 미결 I-5 — **인앱 기본**, UI 토글만; 저장은 멤버 필드 또는 로컬). 외부 채널(이메일/푸시)은 만들지 마라.
- **테마**: 라이트/다크 선택 — 기존 `ThemeProvider`로 `[data-theme]` 전환(컴포넌트 테마 분기 금지, 토큰 오버라이드만, R20).
- **법적 링크**: 약관·개인정보(모달 또는 페이지).
- 상태 3종(로딩·빈 없음·에러, R26).

### 3. E2E (핵심 경로 1개)
- `tests/e2e/profile.spec.ts`: dev 로그인 → `/profile` → 프로필 필드·테마 선택 렌더, 테마 전환이 `data-theme`를 바꿈 확인.

## Acceptance Criteria

```bash
npm run build
npm test                 # vitest run — RTL: 프로필 필드 렌더·수정 검증, 테마 토글이 data-theme 전환, 알림 토글 동작
npm run lint
npx playwright test      # 헤드리스: 로그인→/profile 렌더·테마 전환
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 아키텍처 체크리스트:
   - 프로필 수정이 `PATCH /api/me`(세션 기반)인가(R3)? 새 엔드포인트를 만들지 않았는가?
   - 테마가 `[data-theme]` 토큰 오버라이드로만 전환되는가(컴포넌트 분기 없음, R20)?
   - 외부 알림 채널(이메일/푸시)을 만들지 않았는가(미결 I-5, 인앱 기본)?
   - 읽기=RSC, 토큰만, 상태 3종(ADR-015/R20/R26)?
3. 결과에 따라 `phases/0-mvp/index.json`의 step13을 업데이트:
   - 성공 → `"completed"` + `"summary"`
   - 3회 실패 → `"error"` + `"error_message"`
   - 사용자 개입 필요 → `"blocked"` + `"blocked_reason"` 후 중단

## 금지사항

- **새 프로필/me 엔드포인트를 중복 생성하지 마라.** `PATCH /api/me`(step4)를 사용.
- **외부 알림 채널(이메일/푸시) 발송을 구현하지 마라.** 미결(I-5) — 인앱 토글 UI까지만.
- **컴포넌트에 테마 분기 로직을 넣지 마라.** `[data-theme]` 토큰 오버라이드만(R20).
- **클라이언트가 보낸 식별자를 신뢰하지 마라.** 세션에서(R3).
- **hex 하드코딩·색만 의존 금지**(R20/R29).
- **`test` 워치 모드·E2E 비헤드리스 금지**.
- 기존 테스트를 깨뜨리지 마라.
