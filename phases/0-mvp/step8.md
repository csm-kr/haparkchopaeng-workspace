# Step 8: library

논문 목록 화면을 만든다: 단일 필터 칩 "전체"만, 논문 행(종류 태그·제목·저자·업로더 아바타·날짜) → 클릭 시 논문 상세로. 읽기는 RSC 서버 조회. 논문 상세 화면 자체는 다음 step.

## 읽어야 할 파일

먼저 아래 문서를 읽고 설계 의도를 파악하라. **정본은 루트 `README.md` · `CLAUDE.md` · `PRD.md`이며, 충돌 시 이를 따른다.**

항상:
- `docs/dev/ARCHITECTURE.md` — §데이터 흐름(읽기=RSC 서버 조회)
- `docs/agent/ADR.md` — **ADR-015(RSC 읽기)·ADR-007(필터 "전체"만)**. 고치지 말 것.
- `docs/dev/CODING_CONVENTION.md`

이 step(화면/UI):
- `docs/design/SCREENS.md` — §library(단일 필터 "전체", `.paper-row` 구성) + §화면별 상태
- `docs/design/SCREEN_FLOW.md` — 내비게이션 맵(library → paper)
- `docs/design/DESIGN_GUIDE.md` — 토큰·컴포넌트·§UX 패턴
- `docs/agent/RULES.md` — R17(필터 "전체" 하나만)·R20·R26·R32

이전 step 산출물(재사용):
- `app/(app)/library/page.tsx`(자리표시 → 실제 목록), `app/(app)/layout.tsx`(셸·인증가드)
- `components/ui/*`(Card·Avatar·Badge·Skeleton·EmptyState), `lib/prisma.ts`
- `lib/dashboard.ts`(step7의 서버 조회 패턴 참고 — 일관성 유지)
- `app/api/auth/login/route.ts`(E2E dev 로그인), `playwright.config.ts`

## 작업

### 1. 논문 목록 — `app/(app)/library/page.tsx` (RSC)
- **읽기는 서버에서 직접**(`lib/papers.ts` 같은 서버 함수로 Prisma 조회: 논문 목록 + 업로더(Member) 조인, 최신순). 클라이언트 fetch 금지(ADR-015/R32).
- 구성(SCREENS §library):
  - 헤더: 제목 + **단일 필터 칩 "전체"만**(다른 타입 필터 추가 금지, R17).
  - `.paper-row` 목록: 종류 태그(tags 첫 항목 등)·제목·저자(`authors`)·업로더 `Avatar`·업로드 날짜. 행 클릭 → `/papers/:id`(상세는 다음 step, 링크만).
  - `analysisStatus`가 `pending`/`failed`면 행에 가벼운 표시(예: "분석 중"/"분석 실패") — SCREENS §화면별 상태와 일관.
- 상태 3종: 로딩 `Skeleton` 행, 빈 `EmptyState`("아직 올라온 논문이 없어요" + 업로드 CTA 자리), 에러 카드(R26).

### 2. E2E (핵심 경로 1개)
- `tests/e2e/library.spec.ts`: dev 로그인 → `/library` → 논문 행이 렌더되고(시드 5건), 필터 칩이 "전체" 하나뿐임을 확인. 첫 행 클릭 시 `/papers/...`로 이동(상세 미구현이라 URL 전이까지만 확인).

## Acceptance Criteria

```bash
npm run build
npm test                 # vitest run — RTL: 행 렌더(제목·저자·업로더), 필터 "전체" 단일, 빈 상태
npm run lint
npx playwright test      # 헤드리스: 로그인→/library 행 렌더·필터 단일
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 아키텍처 체크리스트:
   - **필터가 "전체" 하나뿐인가**(타입 필터 없음, R17/ADR-007)?
   - 읽기가 RSC 서버 조회인가(ADR-015/R32)?
   - 빈/로딩/에러 3종이 있는가(R26)? 토큰만(R20)?
   - 논문 상세의 실제 내용을 만들지 않았는가(링크만)?
3. 결과에 따라 `phases/0-mvp/index.json`의 step8을 업데이트:
   - 성공 → `"completed"` + `"summary"`
   - 3회 실패 → `"error"` + `"error_message"`
   - 사용자 개입 필요 → `"blocked"` + `"blocked_reason"` 후 중단

## 금지사항

- **"전체" 외 필터를 추가하지 마라.** 이유: 4인 라이브러리에서 타입 필터는 잡음(R17/ADR-007).
- **클라이언트에서 DB 직접 조회·자체 API fetch 금지.** 읽기는 RSC 서버 조회(ADR-015/R32).
- **논문 상세(AnalysisView·관점 토글·figure·노트)를 만들지 마라.** 이유: 다음 step. 여기선 목록 + 링크만.
- **hex 하드코딩 금지**(R20).
- **`test` 워치 모드·E2E 비헤드리스 금지**(`vitest run`·webServer).
- 기존 테스트를 깨뜨리지 마라.
