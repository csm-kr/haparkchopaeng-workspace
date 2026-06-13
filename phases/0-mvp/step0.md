# Step 0: project-setup

프로토타입(빌드 없는 브라우저 Babel)을 실제 프로덕션 스택으로 재구축하기 위한 **툴체인·디렉토리 골격**을 세운다. 이 step은 화면·도메인 로직을 만들지 않는다 — 빌드/린트/테스트가 헤드리스로 통과하는 빈 프로젝트 뼈대만 만든다.

## 읽어야 할 파일

먼저 아래 문서를 읽고 아키텍처와 설계 의도를 파악하라. **정본은 루트 `README.md` · `CLAUDE.md` · `PRD.md`이며, 충돌 시 이를 따른다.**

항상:
- `docs/dev/ARCHITECTURE.md` — 스택·디렉토리 구조 (특히 §프로덕션 런타임 아키텍처)
- `docs/agent/ADR.md` — 결정 근거 (ADR-009 스택, ADR-010 Prisma/SQLite, ADR-012 상시 서버, ADR-013 워커, ADR-015 RSC/쓰기 경계). **의도된 결정이다. 코드를 보고 "고치지" 말 것.**
- `docs/dev/CODING_CONVENTION.md` — 디렉토리·네이밍·CRITICAL 규칙

이 step에 필요한 것:
- `docs/dev/ENV.md` — 환경 변수 (루트 `.env.example` 이미 존재)
- `docs/agent/RULES.md` — 불변 규칙 (R1·R31·R32·R34 등)

루트 `src/`는 **디자인 프로토타입**(React UMD + 브라우저 Babel)이다. 빌드 대상이 아니며, 이 step에서 컴파일/린트 대상에서 제외한다(아래 금지사항).

## 작업

루트에 Next.js 15 프로젝트를 구성한다. **기존 파일(`docs/`, `src/`, `scripts/`, `phases/`, `.env.example`, `README.md`, `CLAUDE.md`, `PRD.md`, `UX_FLOWS.md`)을 지우지 말 것.** 이미 일부 파일이 있는 디렉토리에 스캐폴딩하므로, `create-next-app`을 쓰기 어렵다면 설정 파일을 직접 작성해도 된다.

### 1. 패키지·스크립트
`package.json`을 만들고 아래 스크립트를 정의한다. **`test`는 반드시 `vitest run`(워치 모드 금지) — 비대화형 실행에서 멈추면 안 된다.**
```jsonc
{
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "lint": "next lint",
    "test": "vitest run"        // CRITICAL: watch 모드(vitest) 금지
  }
}
```
의존성(버전은 안정 최신으로): `next`(15.x), `react`/`react-dom`(19.x), `typescript`, `tailwindcss`, `@prisma/client`, `prisma`(dev), `vitest`, `@testing-library/react`, `@testing-library/jest-dom`, `jsdom`, `@vitejs/plugin-react`, `@playwright/test`(dev), `eslint`, `eslint-config-next`. shadcn/ui는 `npx shadcn@latest init`로 초기화하거나 동등한 설정(`components.json`, `lib/utils.ts`의 `cn()`)을 직접 둔다.

### 2. 디렉토리 골격 (ARCHITECTURE 구조 그대로)
빈 자리 표시 파일이라도 만들어 구조를 고정한다:
```
app/
  layout.tsx              # 루트 레이아웃. <html data-theme>… globals.css import
  page.tsx                # 임시 랜딩(빌드 통과용, 한 줄)
  (auth)/                 # 인증·온보딩 라우트 그룹 (빈 폴더 + .gitkeep 또는 placeholder)
  (app)/                  # 셸 안쪽 화면 (빈 폴더)
  api/                    # route handler — 서버 로직 전용(빈 폴더, .gitkeep)
components/               # 재사용 UI (비어 있음, .gitkeep)
components/ui/            # shadcn 프리미티브
lib/
  utils.ts                # cn()
  prisma.ts               # PrismaClient 싱글톤(전역 캐시) — export const prisma
worker/                   # 백그라운드 잡 워커 (빈 자리, README 한 줄: "ADR-013")
types/                    # 공유 타입 (빈 자리)
prisma/
  schema.prisma           # datasource(sqlite) + generator 만. 모델은 step3에서 추가.
styles/ 또는 app/globals.css  # Tailwind + 디자인 토큰 진입점
```
- `lib/prisma.ts`: 개발 중 핫리로드 재생성을 막는 전역 싱글톤 패턴. 시그니처: `export const prisma: PrismaClient`.
- `prisma/schema.prisma`: `datasource db { provider = "sqlite"; url = env("DATABASE_URL") }` + `generator client { provider = "prisma-client-js" }`. **모델은 넣지 않는다(step3 담당).** `npx prisma generate`가 통과해야 한다.

### 3. TypeScript strict
`tsconfig.json`은 `"strict": true`. **`exclude`에 `src`, `scripts`, `phases`, `docs`를 넣어** 프로토타입을 타입체크 대상에서 제외한다. `paths` 별칭 `@/*` 설정 권장.

### 4. Tailwind + 디자인 토큰 진입점
- Tailwind를 설정하고 글로벌 CSS에서 로드한다.
- 디자인 토큰의 **메커니즘만** 세운다: `:root`(라이트)와 `[data-theme="dark"]`(다크)에 CSS 커스텀 프로퍼티를 정의할 수 있는 글로벌 CSS 파일. 대표 토큰 몇 개(`--bg`, `--fg`, `--accent`)만 두어 빌드가 통과하면 된다. **전체 토큰 이식은 step1(design-system) 담당** — 여기서 전부 옮기지 마라.
- `<html>`에 `data-theme` 속성을 둘 수 있는 구조(루트 레이아웃)만 마련.

### 5. 테스트 하네스
- **Vitest + RTL**: `vitest.config.ts`(jsdom 환경, `@vitejs/plugin-react`, setup에서 `@testing-library/jest-dom`), 그리고 **통과하는 자명한 테스트 1개**(예: `lib/utils.ts`의 `cn()` 동작 또는 sanity `expect(true).toBe(true)`)를 `tests/` 또는 `lib/__tests__/`에 둔다. `npm test`가 0 exit로 끝나야 한다.
- **Playwright**: `@playwright/test` 설치 + `playwright.config.ts`(baseURL `http://localhost:3000`, 헤드리스) + `tests/e2e/` 폴더 자리만. **이 step의 AC에서 E2E를 실행하지 않는다**(브라우저 미설치·화면 미구현). E2E는 step5/6에서 가동.

### 6. 환경 변수
- 루트 `.env.example`는 이미 존재한다. `.env`/`.env.local`은 만들지 말고(키 없음), 코드가 `process.env`에서 읽도록만 둔다. **빌드 시점에 실제 키를 요구해 빌드가 깨지지 않게 한다**(키 없어도 `next build` 통과).
- `DATABASE_URL` 기본값은 `.env.example`의 `file:./dev.db`. 빌드만 통과하면 되고, 마이그레이션은 step3.

## Acceptance Criteria

```bash
npm run build        # next build — 타입/컴파일 에러 없이 통과
npm run lint         # next lint — 에러 없음 (프로토타입 src/ 는 제외 대상)
npm test             # vitest run — 자명한 테스트 1개 통과, 0 exit (워치 금지)
npx prisma generate  # schema.prisma 유효, 클라이언트 생성 통과
```
- 위 네 커맨드가 모두 헤드리스로 통과해야 한다. 특히 `npm run lint && npm run build && npm test`는 프로젝트 Stop 훅과 동일하므로 반드시 함께 통과해야 한다.

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 아키텍처 체크리스트:
   - `docs/dev/ARCHITECTURE.md` 디렉토리 구조(app·components·lib·worker·types·prisma)를 따르는가?
   - `docs/agent/ADR.md`의 스택(Next.js 15·TS strict·Tailwind·Prisma/SQLite)을 벗어나지 않았는가?
   - `docs/dev/CODING_CONVENTION.md` 규칙(서버 로직 위치·네이밍)을 지켰는가?
   - CLAUDE.md CRITICAL 규칙을 위반하지 않았는가?
3. 결과에 따라 `phases/0-mvp/index.json`의 step0를 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary": "생성한 설정/디렉토리/스크립트 한 줄 요약"`
   - 수정 3회 후에도 실패 → `"status": "error"`, `"error_message"`
   - 사용자 개입 필요(예: 네트워크로 의존성 설치 불가) → `"status": "blocked"`, `"blocked_reason"` 후 즉시 중단

## 금지사항

- **프로토타입 `src/`(`*.jsx`, `data.js`, `image-slot.js`, `index.html`, `styles.css`, `tweaks-panel.jsx`)를 빌드/린트/타입체크 대상에 넣지 마라.** 이유: 브라우저 Babel·전역 스코프 코드라 컴파일이 깨진다. `tsconfig` exclude·ESLint ignore로 제외한다.
- **`tweaks-panel.jsx`를 포팅하지 마라.** 이유: 디자인 탐색 도구이지 제품 기능이 아니다(ADR-008/R22).
- **도메인 화면·API 로직·Prisma 모델을 만들지 마라.** 이유: 이 step은 골격만. 모델=step3, 화면=step5~6.
- **디자인 토큰을 전부 옮기지 마라.** 이유: 전체 이식은 step1. 여기선 라이트/다크 메커니즘 + 대표 토큰만.
- **`test` 스크립트를 워치 모드(`vitest`)로 두지 마라.** 이유: 비대화형 실행에서 멈춰 Stop 훅·execute.py가 행(hang)된다. 반드시 `vitest run`.
- **AC에 `npx playwright test`를 넣지 마라.** 이유: 브라우저 미설치·화면 미구현 — 이 step에선 통과 불가. 설정만 둔다.
- **기존 문서/설정 파일(`docs/`, `.env.example`, `CLAUDE.md`, `phases/`)을 삭제·변경하지 마라.**
- 기존 테스트를 깨뜨리지 마라.
