# 프로젝트: hapark — 4인 리서치 그룹 주간 세미나 워크스페이스

매주 토요일 세미나를 진행하는 4인 리서치 그룹(하수현·박진희·조성민·팽진욱)을 위한 **단일 그룹 비공개 워크스페이스**. 세미나 라이브 · 논문 두 관점(연구/재구현) 분석 · 발표 자료 아카이브 · 스케쥴·순번·벌금 · 팀 관리 · NEWS(팀 출판 실적)를 하나로 묶는다. 다중 조직 SaaS가 아니다.

> 브랜드 표기는 **모두의모임(모모)**, 코드·repo·DB·URL 식별자는 `hapark`/하박조팽으로 유지한다(리브랜딩은 UI 카피만).

정본 문맥설계는 `docs/`에 역할별로 있다 — 제품 `docs/user/`, 개발 `docs/dev/`, 디자인 `docs/design/`, 보안 `docs/security/`, 결정·규칙 `docs/agent/`(`ADR.md`·`RULES.md`·`STATE.md`·`ISSUES.md`). 충돌 시 루트 `README.md`·이 파일과 제품 정의 `docs/user/PRD.md`를 따른다. 설계 스펙·플랜은 `docs/superpowers/{specs,plans}/`에 날짜별로 쌓인다(superpowers 워크플로우 산출물).

## 기술 스택
- **Next.js 15** (App Router) + **React 19**, **TypeScript strict**
- **Tailwind CSS v4** + 자체 UI 컴포넌트(`lucide-react`·`clsx`·`tailwind-merge`)
- **Prisma 6** + **Supabase Postgres**(과거 SQLite에서 전환 — schema에 enum 미사용 등 제약 흔적 유지). Auth(Google OAuth)·Storage·Realtime도 Supabase
- **LiveKit (SFU)** — 라이브 다자간 화상·화면공유(ADR-019, Cloudflare Stream Live 대체)
- **Google Gemini**(`@google/genai`) — 논문 분석. **Inngest** durable 잡에서만 호출
- **PDF/figure**: `mupdf`·`pdf-lib`·`pdfjs-dist`·`sharp`
- **검증** `zod` · **테스트** Vitest + Testing Library(단위) / Playwright(E2E)

## 아키텍처 규칙
- **CRITICAL: 모든 서버·외부 로직은 route handler(`app/api/**/route.ts`)나 Server Action에서만.** 클라이언트 컴포넌트에서 DB(Prisma)·LiveKit·스토리지·Gemini를 직접 호출하지 않는다. 읽기는 RSC의 `lib/` 서버 함수(Prisma 직접), 쓰기는 route handler/Server Action. (ADR-015)
- **CRITICAL: 긴 작업(논문 분석·arXiv fetch)은 요청 경로에서 인라인 금지.** API는 잡만 적재하고 즉시 응답(`analysisStatus=pending`), 실제 처리는 **Inngest 잡(`worker/`)**이 한다. (ADR-013)
- **CRITICAL: 활성 팀 스코핑.** 도메인 엔티티는 `teamId`로 스코핑한다. 쓰기 시 `teamId`·작성자/소유자 ID는 **서버가 세션·활성 팀에서 주입**하고 클라 입력은 미신뢰. 다른 팀 자원 접근은 404/403. (ADR-020 · R37 · R3)
- **CRITICAL: 비밀은 `.env`(서버)에서만.** `NEXT_PUBLIC_*`에 키 금지, 클라 번들 노출 금지. 외부 키가 없어도 build/test는 통과해야 하고(미설정 기능은 503으로 안내), `.env` 등 비밀 파일은 직접 읽지 않는다(차단 훅 존재). 필요 변수 목록은 `.env.example`·`docs/dev/ENV.md` 참고(둘 다 비밀 아님). (R2)
- 컴포넌트는 `components/`, 타입은 `types/`, 서버 유틸은 `lib/`, 백그라운드 잡은 `worker/`. 역할·상태 등은 enum 대신 `String` + zod 검증.
- **주의: `src/`는 첫 커밋의 레거시 디자인 프로토타입(`.jsx` 목업·`index.html`)이며 실제 앱이 아니다 — tsconfig `exclude` 대상. 실제 UI/코드는 `app/`·`components/`에 있다.**

## 개발 프로세스
- **CRITICAL: TDD.** 새 기능·버그픽스는 테스트를 먼저 쓰고(RED) 통과하는 구현을 작성한다(GREEN). 위치: 단위 `lib/__tests__`·`app/api/**/__tests__`·`components/**/__tests__`, E2E `tests/e2e/`(Playwright).
- **Harness 워크플로우.** 새 기능은 `phases/<n-name>/stepN.md`로 설계한 뒤 단계 실행한다.
- 커밋은 **conventional commits**(`feat:`·`fix:`·`docs:`·`refactor:`, 스코프 예 `feat(news): …`).
- **CRITICAL: 커밋 시 변경 경로만 명시 스테이징**(`git add <경로>`). `git add -A` 금지 — 무관 변경·동시 실행 클로버 위험.

## 명령어
```
npm run dev          # 개발 서버 (next dev)
npm run build        # 프로덕션 빌드
npm run lint         # ESLint (next lint)
npm run test         # 단위 테스트 (vitest run)
npx playwright test  # E2E
npx prisma db push   # 스키마 동기화  (npx prisma db seed: 시드)
npx prisma generate  # Prisma Client 재생성
npx inngest-cli dev  # 로컬 잡 러너
```
