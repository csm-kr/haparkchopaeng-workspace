# Step 11: presentations

발표 자료 목록 + 자료 상세(뷰어 + **@멘션·반응이 있는 스레드형 회고 댓글**)를 만든다. 댓글은 발표 자료에 귀속된다(논문 상세엔 댓글 패널 없음 — ADR-004).

## 읽어야 할 파일

먼저 아래 문서를 읽고 설계 의도를 파악하라. **정본은 루트 `README.md` · `CLAUDE.md` · `PRD.md`이며, 충돌 시 이를 따른다.**

항상:
- `docs/dev/ARCHITECTURE.md` — §데이터 흐름(읽기 RSC, 쓰기 Server Action/route)
- `docs/agent/ADR.md` — **ADR-004(회고 댓글은 발표 자료 귀속)·ADR-015**. 고치지 말 것.
- `docs/dev/CODING_CONVENTION.md`

이 step(화면 + 댓글 쓰기):
- `docs/design/SCREENS.md` — §presentations·§presentation(뷰어 + 댓글 스레드) + §화면별 상태
- `docs/user/USER_FLOW.md` — **F5(발표 자료 회고)** — textarea Cmd/Ctrl+Enter·@멘션·반응
- `docs/dev/DB.md` — `Presentation`·`PresentationAsset`·`PresentationVersion`·`Comment`(+slide)·`Reaction`(@@unique)
- `docs/dev/API.md` — 발표 자료·댓글·반응 엔드포인트
- `docs/security/SECURITY.md` — 작성자는 세션에서(R3)
- `docs/agent/RULES.md` — R3·R20·R26·R27·R29·R32

이전 step 산출물(재사용):
- `app/(app)/presentations/page.tsx`·`app/(app)/presentations/[id]`(없으면 생성), `app/(app)/layout.tsx`
- `components/ui/*`·`lib/prisma.ts`·`lib/auth.ts`
- `lib/papers.ts`/`lib/schedule.ts`(서버 조회·Server Action 패턴 일관), `types/`(Presentation·Comment·Reaction DTO)
- `components/analyzer/actions.ts`(노트 Server Action 패턴 — 작성자 세션 주입·낙관적·revalidatePath 참고)
- `app/api/auth/login/route.ts`(E2E), `playwright.config.ts`

## 작업

### 1. 목록 (RSC) — `app/(app)/presentations/page.tsx`
- `lib/presentations.ts` `getPresentations()`: 발표 자료 목록(최신순, 발표자 조인). 개수 표시("N개"). 항목 클릭 → `/presentations/:id`.
- 상태 3종(로딩 스켈레톤·빈·에러, R26).

### 2. 상세 (RSC) — `app/(app)/presentations/[id]/page.tsx`
- `getPresentationDetail(id)`: Presentation + assets + versions + comments(작성자 조인, reactions 포함).
- **자료 뷰어**: slides/keypoints/summary + 에셋 목록 + 버전 이력(있으면).
- **댓글 스레드**: 아바타·이름·시간·텍스트(**@멘션 링크화**)·**반응**(이모지 토글)·슬라이드 참조(있으면). 시간순.

### 3. 댓글 쓰기 — Server Action / route handler
- 댓글 작성: textarea(**Cmd/Ctrl+Enter 전송**)·@멘션·`slide?`. 반응 토글. (API.md 계약)
- **CRITICAL: 작성자(authorId)는 세션에서 주입**(클라 값 무시, R3). @멘션은 본문에서 파싱(알림 트리거는 미결 — 지금은 파싱·링크화만, ISSUES I-5).
- **낙관적 추가**(댓글·반응) → 실패 시 롤백+토스트. 변이 후 `revalidatePath`.
- 반응 `Reaction`은 `@@unique([commentId, memberId, emoji])` — 토글(있으면 제거).

### 4. E2E (핵심 경로 1개)
- `tests/e2e/presentation.spec.ts`: dev 로그인 → `/presentations` → 항목 클릭 → 상세에서 기존 댓글 렌더 확인(시드 pres1 댓글). (작성까지 가면 좋지만 최소 렌더 확인)

## Acceptance Criteria

```bash
npm run build
npm test                 # vitest run — RTL: 목록 개수·댓글 스레드 렌더·@멘션 링크화·반응 토글·작성자 세션 주입·빈값 검증(인라인)
npm run lint
npx playwright test      # 헤드리스: 로그인→/presentations→상세 댓글 렌더
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 아키텍처 체크리스트:
   - 댓글이 **발표 자료에 귀속**되는가(논문 상세엔 댓글 없음, ADR-004)?
   - 작성자가 **세션에서** 주입되는가(클라 미신뢰, R3)?
   - 반응 토글이 유니크 제약을 지키는가? @멘션이 링크화되는가?
   - 읽기=RSC, 쓰기=Server Action/route, 토큰만(ADR-015/R20)? 상태 3종(R26)?
3. 결과에 따라 `phases/0-mvp/index.json`의 step11을 업데이트:
   - 성공 → `"completed"` + `"summary"`
   - 3회 실패 → `"error"` + `"error_message"`
   - 사용자 개입 필요 → `"blocked"` + `"blocked_reason"` 후 중단

## 금지사항

- **논문 상세에 댓글 패널을 만들지 마라.** 회고 댓글은 발표 자료 귀속(ADR-004/R9).
- **클라이언트가 보낸 authorId를 신뢰하지 마라.** 세션에서(R3).
- **클라이언트 DB 직접 조회·자체 API fetch 금지**(읽기=RSC, ADR-015/R32).
- **검증 실패를 토스트로 띄우지 마라.** 입력 옆 인라인(R30).
- **hex 하드코딩·색만 의존 금지**(R20/R29).
- **`test` 워치 모드·E2E 비헤드리스 금지**.
- 기존 테스트를 깨뜨리지 마라.
