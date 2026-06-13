# 코딩 컨벤션 (Coding Convention)

> 아키텍처는 [`./ARCHITECTURE.md`](./ARCHITECTURE.md), 불변 규칙 모음은 [`../agent/RULES.md`](../agent/RULES.md), 디자인 토큰은 [`../design/DESIGN_GUIDE.md`](../design/DESIGN_GUIDE.md)를 본다. CLAUDE.md의 CRITICAL 규칙이 최상위 권위를 가진다.

## 스택

- **프레임워크:** Next.js 15 (App Router)
- **언어:** TypeScript **strict mode**
- **스타일:** Tailwind CSS + `src/styles.css`에서 이식한 디자인 토큰(CSS 커스텀 프로퍼티)
- **UI 프리미티브:** shadcn/ui(Radix 기반) 권장
- **ORM/DB:** Prisma + SQLite ([`./DB.md`](./DB.md))
- **검증:** zod (API 입력 경계)
- **테스트:** Vitest + React Testing Library (CLAUDE.md: TDD)

## 디렉토리 (프로덕션 목표)

```
app/
  (auth)/                 # 인증·온보딩 라우트 그룹
  (app)/                  # 셸 안쪽 화면들
    dashboard/  library/  papers/[id]/  presentations/[id]/
    schedule/  team/  meeting/  profile/
  api/                    # CRITICAL: 모든 서버 로직은 여기 route handler에서만
    papers/  presentations/  schedule/  live/  invites/ …
components/               # 재사용 UI (shell, analyzer, cards …) — 기본 RSC, 인터랙티브만 "use client"
lib/                      # 서버 유틸: prisma, supabase(server/admin/realtime), cloudflare, gemini(@google/genai), storage, auth, validators
worker/                   # 백그라운드 잡 워커(분석·arXiv·녹화) — 요청 경로와 분리 (ADR-013)
types/                    # 공유 타입
prisma/                   # schema.prisma, seed.ts
styles/                   # 토큰·전역 css
```

> **RSC/클라이언트 경계:** 화면은 기본 서버 컴포넌트(RSC)로 두고 데이터는 `lib/` 서버 함수로 직접 조회한다. `"use client"`는 인터랙티브 섬(live 룸·관점 토글·스케줄 편집·업로드 모달·명령 팔레트)에만 붙인다. 변이는 Server Action/route handler. (ADR-015)

## CRITICAL 규칙 (CLAUDE.md 직결)

1. **모든 서버/외부 로직은 서버에서만** — 읽기는 RSC의 `lib/` 서버 함수(Prisma 직접), 쓰기는 route handler/Server Action. 클라이언트 컴포넌트에서 DB·Cloudflare·스토리지·외부 API 직접 호출 금지. (ADR-015)
2. **긴 작업(분석·arXiv·녹화)은 요청 경로가 아니라 `worker/`에서.** API는 잡만 적재하고 즉시 응답. 인라인 LLM 호출 금지(타임아웃). (ADR-013)
3. **클라이언트 컴포넌트에서 외부 API 직접 호출 금지.** 항상 자체 API/서버를 경유한다.
4. **컴포넌트는 `components/`, 타입은 `types/`로 분리.**
5. **TDD:** 새 기능은 테스트를 먼저 작성하고, 통과하는 구현을 작성한다.
6. **커밋:** Conventional Commits (`feat:`, `fix:`, `docs:`, `refactor:`).

## 네이밍

| 대상 | 규칙 | 예 |
|---|---|---|
| 컴포넌트 파일/이름 | PascalCase | `AnalysisView.tsx` |
| 훅 | `useXxx` camelCase | `useLiveSession` |
| route handler 폴더 | kebab/리소스 복수형 | `app/api/papers/` |
| 타입/인터페이스 | PascalCase | `SectionNote`, `Lens` |
| 상수 | UPPER_SNAKE | `MAX_PDF_MB` |
| DB 모델 | PascalCase 단수 | `Paper`, `ScheduleWeek` |

> 프로토타입의 **파일별 훅 별칭**(`useAnState` 등)은 빌드 없는 전역 스코프 회피용 임시방편이다. 프로덕션에선 표준 `import { useState }`를 쓰고 별칭을 **포팅하지 않는다**.

## 스타일링 규칙

- **CRITICAL: 색·반경·그림자·간격은 토큰만 사용.** 컴포넌트에 hex/임의값 하드코딩 금지 — 라이트/다크·액센트 스위칭이 깨진다([`../design/DESIGN_GUIDE.md`](../design/DESIGN_GUIDE.md)).
- 라이트/다크는 `[data-theme]` 토큰 오버라이드만으로 동작해야 한다. 컴포넌트에 테마 분기 로직을 넣지 않는다.
- 허용된 keyframes 외 임의 애니메이션 금지(DESIGN_GUIDE "애니메이션" 절).

## 타입 규칙

- `strict: true`. `any` 금지(불가피하면 `unknown` + 좁히기).
- 공유 도메인 타입은 `types/`에 두고 Prisma 생성 타입과 분리(API 경계 DTO).
- 관점·역할·상태 같은 유한 집합은 **유니온 리터럴 타입**으로:
  ```ts
  type Lens = 'research' | 'repro';
  type NoteLens = Lens | 'any';
  type Role = '관리자' | '멤버' | '게스트';
  type WeekStatus = 'done' | 'upcoming'; // 'current'는 파생
  ```

## API 핸들러 규칙

- 입력은 **zod로 검증**하고 실패 시 `400`. 경계에서만 검증하고 내부는 타입을 신뢰.
- **신뢰 경계:** 작성자/소유자 ID는 클라이언트 입력이 아니라 **세션에서** 취한다.
- 권한 체크를 핸들러 진입부에서 먼저 수행(`401`/`403`).
- 응답은 `{ data }` / `{ error: { code, message } }` 일관 포맷.

## 테스트 규칙 (TDD)

- 도메인 로직(순번 계산, 벌금 파생, 빈 달 판별)은 순수 함수로 분리해 단위 테스트.
- API 핸들러는 권한·검증·핵심 불변식(예: 동시 라이브 1개, 월 자동생성 금지) 위주로.
- 컴포넌트는 조건부 UI(빈 상태/편집/확정, live on/off)를 RTL로.

## 금지 (Don'ts)

- `tweaks-panel.jsx` 포팅 금지. 이유: 제품 기능이 아니라 디자인 탐색 도구다.
- 화면 컴포넌트 안에 `live` 상태 보관 금지. 이유: 배지·배너·룸이 어긋난다(ADR-001).
- 논문 상세에 탭/사이드패널 추가 금지. 이유: 두 관점 토글 자체가 페이지다(ADR-004).
- 토큰 대신 hex 하드코딩 금지. 이유: 다크/액센트 스위칭이 깨진다.
