# Step 9: paper-analysis

논문 상세 화면(AnalysisView)을 만든다 — 제품의 핵심. 두 관점(연구/재구현) 토글, 섹션 카드, 두 관점 공통 Figure 분석, **섹션별 작성자 표기 협업 노트**. 헤더 액션은 원문 PDF 다운로드 하나뿐. 탭/사이드패널 없음.

## 읽어야 할 파일

먼저 아래 문서를 읽고 설계 의도를 파악하라. **정본은 루트 `README.md` · `CLAUDE.md` · `PRD.md`이며, 충돌 시 이를 따른다.**

항상:
- `docs/dev/ARCHITECTURE.md` — §데이터 흐름(읽기=RSC, 쓰기=Server Action/route handler)
- `docs/agent/ADR.md` — **ADR-004(두 관점·figure 공통·탭 없음)·ADR-005(노트 섹션별·작성자)·ADR-015(읽기/쓰기 경계)**. 고치지 말 것.
- `docs/dev/CODING_CONVENTION.md`

이 step(화면 + 노트 쓰기):
- `docs/design/SCREENS.md` — §paper(상단바 단일 PDF 액션·관점 토글·섹션·Figure·섹션별 노트) + §화면별 상태(분석 대기/실패)
- `docs/user/USER_FLOW.md` — **F3(논문 분석 읽기·노트 작성)** 상태 머신(`addingSec`·검증)
- `docs/design/SCREEN_FLOW.md` — §paper/AnalysisView 상태(currentLens·addingSec·렌더 필터)
- `docs/dev/DB.md` — `Analysis(payload)`·`Figure`·`SectionNote` 구조
- `docs/dev/API.md` — 노트 엔드포인트(POST/GET/DELETE), 작성자 세션 주입
- `docs/security/SECURITY.md` — 작성자/소유자는 세션에서(R3)
- `docs/agent/RULES.md` — **R9(탭 금지)·R10(두 관점·figure 공통)·R11(노트 섹션별·작성자)·R13(PDF 단일 액션)·R20·R26·R29·R32·R3**

이전 step 산출물(재사용):
- `app/(app)/papers/[id]/page.tsx`(자리표시 → 실제), `app/(app)/layout.tsx`(셸·인증가드)
- `components/ui/*`(Card·Avatar·Badge·Skeleton·EmptyState·Button·Input), `lib/prisma.ts`·`lib/auth.ts`
- `lib/papers.ts`(step8의 조회 패턴 — 일관성), `types/`(Lens·NoteLens·Analysis<L>·SectionNote·Figure DTO)
- `app/api/auth/login/route.ts`(E2E), `playwright.config.ts`

## 작업

### 1. 상세 조회 (RSC) — `app/(app)/papers/[id]/page.tsx`
- `lib/papers.ts`에 `getPaperDetail(id)` 추가: Paper + Analysis(research/repro) + Figure[] + SectionNote[] (작성자 Member 조인). RSC 서버 조회(ADR-015/R32).
- 헤더: 브레드크럼 · 제목 · 저자/메타. **상단바 액션 = `⬇ 원문 PDF` 단 하나**(arXiv/공유 버튼 추가 금지, R13). PDF는 `paper.pdfUrl` 링크(실제 서명 URL은 스토리지 step — 지금은 링크/스텁).
- **탭/사이드패널을 만들지 마라**(R9/ADR-004).

### 2. AnalysisView — `components/analyzer/`
- **관점 토글(상단 고정, 클라이언트 섬)**: `currentLens: 'research' | 'repro'` + 한 줄 힌트. 토글로 섹션 세트 전환.
  - 연구: Problem Setting · Contribution · Input/Output · Comparison · Ablation
  - 재구현: 데이터 · 모델 · 학습 · 리소스
  - 각 섹션은 `Analysis.payload`의 해당 필드를 평이하게 렌더(표는 표로).
- **Figure 분석(두 관점 공통, 하단 고정)**: 관점과 무관하게 항상 같은 figure 카드들을 하단에 둔다(R10/ADR-004). 각 figure: **"원문 PDF p.{sourcePage}에서 추출"** 배지 · 이미지(`imageUrl` 있으면 표시, 없으면 플레이스홀더 박스) · 캡션 · **설명(interpretation)**.
- **섹션별 노트(작성자 표기)**: 각 섹션(Figure 포함)에 `+ 이 섹션에 분석 추가`.
  - 상태 머신(USER_FLOW F3): `addingSec: string | null`(한 번에 하나). 인라인 폼(제목+본문) → 취소/추가. **검증은 인라인**(제목·본문 빈 값 → "내용을 입력해주세요", 토스트 아님).
  - 노트는 `{sectionId, lens}`로 스코프. **Figure 노트는 `lens:'any'`**(어느 관점에서도 figure 아래 표시, R11/ADR-005).
  - 노트 카드: 작성자 `Avatar`+이름+제목+본문+삭제(×). **낙관적 추가** → 실패 시 롤백+토스트.

### 3. 노트 쓰기 — Server Action 또는 route handler
- 노트 추가/삭제는 **Server Action**(또는 `app/api/papers/[id]/notes`·`app/api/notes/[id]` route handler). API.md 계약을 따른다.
- **CRITICAL: 작성자(authorId)는 세션에서 주입**(클라가 보낸 값 무시, R3). `sectionId==='figures'`면 서버가 `lens='any'`로 강제. 변이 후 `revalidatePath`.

### 4. 분석 상태 처리
- `analysisStatus==='pending'`/`'failed'`면 분석 섹션을 스켈레톤/"읽는 중"/"분석 못 끝냈어요 + 다시 분석" 상태로(재분석 트리거는 jobs step — 지금은 표시만). **원문 PDF 다운로드는 분석 상태와 무관하게 동작**(SCREENS §화면별 상태).

### 5. E2E (핵심 경로 1개)
- `tests/e2e/paper.spec.ts`: dev 로그인 → `/papers/{시드 p1}` → 연구 섹션 표시 → 관점 토글로 재구현 섹션 전환 → **Figure 분석이 두 관점 모두에서 보임** 확인.

## Acceptance Criteria

```bash
npm run build
npm test                 # vitest run — RTL: 관점 토글 섹션 전환, figure가 양 관점 공통 렌더, 노트 추가 검증·작성자 표기, figure 노트 lens=any
npm run lint
npx playwright test      # 헤드리스: 로그인→논문 상세→관점 토글→figure 양 관점 노출
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 아키텍처 체크리스트:
   - **탭/사이드패널이 없는가**(두 관점 토글이 페이지 자체, R9/ADR-004)?
   - 두 관점이 research/repro 둘뿐이고 **Figure가 두 관점 공통 하단 고정**인가(R10)?
   - 노트가 `{sectionId, lens}` 스코프이고 **작성자가 세션에서** 주입되는가(figure 노트=any, R11/R3/ADR-005)?
   - 상단바 액션이 **원문 PDF 하나뿐**인가(R13)?
   - 읽기=RSC, 쓰기=Server Action/route handler인가(ADR-015)? 토큰만(R20)?
3. 결과에 따라 `phases/0-mvp/index.json`의 step9를 업데이트:
   - 성공 → `"completed"` + `"summary"`
   - 3회 실패 → `"error"` + `"error_message"`
   - 사용자 개입 필요 → `"blocked"` + `"blocked_reason"` 후 중단

## 금지사항

- **논문 상세에 탭이나 사이드 패널(AI 요약·팀 노트 패널 등)을 추가하지 마라.** 이유: 두 관점 토글 자체가 페이지(R9/ADR-004).
- **Figure 분석을 특정 관점에만 두지 마라.** 두 관점 공통 하단 고정, 노트는 `lens:'any'`(R10/R11/ADR-005).
- **클라이언트가 보낸 authorId를 신뢰하지 마라.** 작성자는 세션에서(R3/SECURITY).
- **상단바에 arXiv·공유 버튼을 추가하지 마라.** 원문 PDF 다운로드 하나만(R13).
- **노트 검증 실패를 토스트로 띄우지 마라.** 입력 옆 인라인(DESIGN_GUIDE §UX 패턴).
- **클라이언트에서 DB 직접 조회·자체 API fetch 금지**(읽기=RSC, ADR-015/R32).
- **hex 하드코딩·색만으로 정보 전달 금지**(R20/R29).
- **`test` 워치 모드·E2E 비헤드리스 금지**.
- 기존 테스트를 깨뜨리지 마라.
