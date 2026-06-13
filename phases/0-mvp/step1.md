# Step 1: design-system

프로토타입 `src/styles.css`의 디자인 토큰을 프로덕션 `app/globals.css`로 이식하고, 토큰 기반 **기본 UI 컴포넌트**(Card·Button·Badge·Avatar·Input + Skeleton·EmptyState)를 만든다. 화면·도메인 로직은 만들지 않는다.

## 읽어야 할 파일

먼저 아래 문서를 읽고 설계 의도를 파악하라. **정본은 루트 `README.md` · `CLAUDE.md` · `PRD.md`이며, 충돌 시 이를 따른다.**

항상:
- `docs/dev/ARCHITECTURE.md` — 스택·디렉토리
- `docs/agent/ADR.md` — 결정 근거 (특히 ADR-004/008, 디자인 관련). **고치지 말 것.**
- `docs/dev/CODING_CONVENTION.md` — 네이밍·스타일 규칙

이 step(디자인 레이어):
- `docs/design/DESIGN_GUIDE.md` — 토큰·컴포넌트 명세 + §UX 패턴(상태 3종·접근성·모션)
- `docs/design/SCREENS.md` — 화면별 상태(빈/로딩/에러)에서 Skeleton·EmptyState가 어떻게 쓰이는지
- `docs/agent/RULES.md` — R20(토큰만)·R21(정직한 빈 상태)·R26(상태 3종)·R29(모션·색 의존 금지)

**토큰 값의 출처는 프로토타입 `src/styles.css`다.** 이 파일을 읽어 `:root`(라이트)와 `[data-theme="dark"]`의 모든 커스텀 프로퍼티(색·반경·그림자·간격·폰트·멤버색·시맨틱)를 그대로 옮긴다. (단 `src/`는 여전히 빌드/린트 대상이 아니다 — 값만 참고한다.)

이전 step 산출물(읽고 일관성 유지):
- `app/globals.css` — 토큰 메커니즘 자리(여기에 전체 토큰 이식)
- `app/layout.tsx` — `<html data-theme="light">` (테마 속성 위치)
- `lib/utils.ts` — `cn()` (컴포넌트에서 클래스 병합에 사용)
- `components/ui/` — 여기에 컴포넌트를 둔다

## 작업

### 1. 토큰 이식 — `app/globals.css`
- `src/styles.css`의 `:root`/`[data-theme="dark"]` 커스텀 프로퍼티 전체를 옮긴다: 배경(`--bg`,`--bg-elevated`,`--bg-subtle`,`--bg-hover`,`--bg-active`), 텍스트(`--fg`,`--fg-muted`,`--fg-subtle`,`--fg-faint`), 액센트(`--accent`,`--accent-hover`,`--accent-soft`,`--accent-faint`,`--accent-fg`), 시맨틱(`--online`,`--away`,`--busy`), 멤버색(`--m-ha`,`--m-bak`,`--m-jo`,`--m-paeng`), 경계(`--border`,`--border-strong`), 반경(`--r-xs`~`--r-xl`), 그림자(`--shadow-xs`~`--shadow-lg`), 폰트(`--font-sans`,`--font-mono`), 간격/밀도.
- **라이트/다크는 `[data-theme]` 토큰 오버라이드만으로 전환**되어야 한다(컴포넌트에 테마 분기 금지).
- Tailwind v4의 CSS-우선 설정(`@theme`)으로 토큰을 Tailwind 색/반경 유틸에 매핑하거나, 컴포넌트가 `var(--token)`을 직접 참조하게 한다. **어느 쪽이든 컴포넌트에 hex/raw 값 하드코딩 금지.**
- 허용된 keyframes만 정의: `shimmer`(스켈레톤), `livepulse`(LIVE), `slidein`(토스트), `fade-up`/`floatup`. **`prefers-reduced-motion: reduce`에서 이 애니메이션을 정지/대체**한다(접근성, R29).

### 2. 기본 컴포넌트 — `components/ui/`
시그니처 수준으로 만들되, variant·크기는 DESIGN_GUIDE를 따른다. 모두 `cn()` 사용, 토큰만 참조.
- `button.tsx` — `Button`: variant `primary|secondary|ghost`, size `sm|md|lg`, `danger`(위험, `--busy`). 파괴적 액션용 위험 버튼 포함(R27).
- `card.tsx` — `Card`: `hoverable` 시 border-strong + shadow-sm.
- `badge.tsx` — `Badge`: 역할(관리자=액센트 틴트/멤버=중립/게스트=앰버 틴트)·상태(`online|away|busy`) variant. **색에만 의존하지 말고 라벨/아이콘 병행**(R29).
- `avatar.tsx` — `Avatar({ user })`: 이니셜 + 멤버 색 타일, `aria-label`(예: "조성민 아바타").
- `input.tsx` — `Input`: 포커스 시 `--accent` 보더 + `--accent-soft` 링.
- `skeleton.tsx` — `Skeleton`: `shimmer` 로딩 표현(레이아웃 유지). 로딩 상태용(R26).
- `empty-state.tsx` — `EmptyState({ icon, title, action })`: 정직한 빈 상태 + CTA 하나(R21).

> 아이콘은 Lucide(`lucide-react`)로 매핑한다(없으면 설치). 외부 브랜드 에셋 없음.

### 3. 데모/검증 라우트(선택, 가벼움)
필요하면 `app/page.tsx`에 컴포넌트 미리보기를 둘 수 있으나 **도메인 화면을 만들지 마라**. 빌드 통과가 목적.

## Acceptance Criteria

```bash
npm run build   # 컴파일·타입 에러 없음
npm test        # vitest run — 컴포넌트 RTL 테스트 통과(예: Button variant 렌더, Avatar aria-label, EmptyState CTA)
npm run lint    # ESLint 에러 없음
```
- 최소 RTL 테스트: Button이 variant별로 렌더되는지, Avatar에 `aria-label`이 있는지, EmptyState가 action을 렌더하는지.

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 아키텍처 체크리스트:
   - `docs/design/DESIGN_GUIDE.md` 토큰·컴포넌트 명세를 따르는가?
   - 라이트/다크가 `[data-theme]` 오버라이드만으로 동작하는가? 컴포넌트에 hex 하드코딩이 없는가?
   - `prefers-reduced-motion`에서 깜빡임/시머가 정지/대체되는가?
   - `docs/agent/ADR.md` 스택을 벗어나지 않았는가?
3. 결과에 따라 `phases/0-mvp/index.json`의 step1을 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary": "이식한 토큰·생성한 컴포넌트 한 줄 요약"`
   - 3회 실패 → `"status": "error"`, `"error_message"`
   - 사용자 개입 필요 → `"status": "blocked"`, `"blocked_reason"` 후 중단

## 금지사항

- **컴포넌트에 hex/raw 색·간격 값을 하드코딩하지 마라.** 이유: 다크/액센트 스위칭이 깨진다(R20). 항상 토큰(`var(--…)` 또는 토큰 매핑된 Tailwind 유틸).
- **화면에 `live` 상태를 보관하거나 도메인 화면(대시보드·논문 등)을 만들지 마라.** 이유: 이 step은 디자인 시스템만. 화면은 step5~6, `live`는 앱 레벨(ADR-001).
- **`tweaks-panel.jsx`를 포팅하지 마라.** 이유: 제품 기능 아님(R22).
- **프로토타입 `src/`를 빌드/린트 대상에 넣지 마라.** 값만 읽는다.
- **깜빡임·색만으로 정보를 전달하지 마라.** 라벨/아이콘 병행, reduced-motion 대체(R29).
- **`test`를 워치 모드로 두지 마라**(`vitest run` 유지). 이유: 비대화형 실행이 멈춘다.
- 기존 테스트를 깨뜨리지 마라.
