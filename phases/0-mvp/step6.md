# Step 6: app-shell

영속 셸(사이드바 + 상단바)·라우팅·테마 토글·**앱 레벨 `live` 상태**를 만든다. 각 화면은 자리표시(placeholder)로 두고 실제 내용은 이후 step에서 채운다. 도메인 로직은 만들지 않는다.

## 읽어야 할 파일

먼저 아래 문서를 읽고 설계 의도를 파악하라. **정본은 루트 `README.md` · `CLAUDE.md` · `PRD.md`이며, 충돌 시 이를 따른다.**

항상:
- `docs/dev/ARCHITECTURE.md` — §데이터 흐름(RSC 레이아웃 + 인터랙티브 섬), §실시간 동기화(SSE)
- `docs/agent/ADR.md` — **ADR-001(`live` 앱 레벨)·ADR-014(SSE)·ADR-015(RSC/클라 경계)**. 고치지 말 것.
- `docs/dev/CODING_CONVENTION.md` — RSC/클라이언트 경계

이 step(화면/UI):
- `docs/design/SCREENS.md` — §영속 셸(사이드바 내비 순서·LIVE 알약·멤버 목록·상단바)
- `docs/design/SCREEN_FLOW.md` — 내비게이션 맵·앱 레벨 상태가 좌우하는 표면(배지·배너·룸)
- `docs/design/DESIGN_GUIDE.md` — 토큰·컴포넌트·§UX 패턴(접근성·모션)
- `docs/agent/STATE.md` — 앱 레벨 상태(`live`·theme·collapsed) vs 화면별
- `docs/agent/RULES.md` — **R5(화면에 live 보관 금지)·R20(토큰만)·R29(깜빡임·색 의존 금지)·R33(live SSE)**

이전 step 산출물(재사용):
- `components/ui/*` — Button·Card·Badge·Avatar·Skeleton·EmptyState 등
- `app/globals.css` — 디자인 토큰, `app/layout.tsx`의 `<html data-theme>`
- `lib/auth.ts` — `getSession`(셸이 현재 멤버·역할 표시에 사용)
- `lib/prisma.ts` — 멤버 목록 조회(사이드바 하단)

## 작업

### 1. 앱 레벨 상태 — 클라이언트 컨텍스트 (CRITICAL)
- `components/providers/`(또는 `lib/`)에 **`LiveProvider` + `useLive()`**: `{ live: boolean, setLive }`. **`live`는 앱 레벨에 단 하나** — 화면 컴포넌트에 보관 금지(ADR-001/R5).
- **SSE 구독 훅**: `live.started/ended`를 받는 `useLiveStream`이 `/api/live/stream`을 구독해 `setLive`를 호출하는 골격을 둔다. **엔드포인트가 아직 없으니(라이브 step) graceful no-op**(연결 실패 시 조용히 무시). 폴링 금지(R33).
- **테마**: `ThemeProvider` + 토글 — `<html data-theme>`를 `light`/`dark` 전환, 선호 저장(cookie 또는 localStorage). 컴포넌트에 테마 분기 로직 금지(토큰 오버라이드만).
- 사이드바 `collapsed` 상태도 앱 레벨/셸 레벨로.

### 2. 영속 셸 — `components/shell/`
- `Sidebar`: 로고("하박조팽") · 내비 목록(**홈·논문·발표 자료·아이디어·스케쥴·팀 관리·세미나 라이브** 순) · 접기 토글 · 하단 멤버 목록(클릭 → 팀 관리). 내비 항목 선택적 `count`/`unread` 배지. **`meeting` 항목은 `live===true`일 때만 깜빡이는 LIVE 알약**(이때 count 억제). **`prefers-reduced-motion`에서 정적 배지**(R29).
- `Topbar`: 좌측 브레드크럼 + 우측 맥락 액션 슬롯(`<Topbar crumbs actions />`).
- **현재 활성 내비**는 현재 경로 기준.

### 3. 라우팅 + 자리표시 화면 — `app/(app)/`
- `(app)/layout.tsx`(RSC): 셸로 감싸고 `LiveProvider`/`ThemeProvider`(클라이언트) 안에 `children`. 미인증 시 로그인으로(서버에서 `getSession` 확인).
- 각 내비 대상 라우트 세그먼트 생성 + **자리표시 페이지**(`EmptyState` 또는 "준비 중" 한 줄): `dashboard`·`library`·`presentations`·`ideas`·`schedule`·`team`·`meeting`·`profile`. 실제 화면은 이후 step.
- 홈 배너: `live===true`일 때 대시보드 상단 LIVE 배너 자리(실제 룸 링크는 라이브 step). `live===false`면 숨김.

### 4. 셸은 인터랙티브 섬
- 레이아웃은 RSC, 셸의 상호작용 부분(사이드바 토글·테마·live 컨텍스트)만 `"use client"`. 데이터 읽기(멤버·세션)는 서버에서(ADR-015).

## Acceptance Criteria

```bash
npm run build   # 타입/컴파일 에러 없음
npm test        # vitest run — RTL: 사이드바 내비 렌더·순서, live=true일 때 LIVE 알약 표시(useLive 컨텍스트), 테마 토글이 data-theme 전환
npm run lint
```
> E2E(Playwright)는 이 step에서 실행하지 않는다 — 실제 화면이 있는 step7(dashboard)에서 가동한다.

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 아키텍처 체크리스트:
   - **`live`가 앱 레벨(컨텍스트)에 단 하나인가?** 화면 컴포넌트에 보관하지 않았는가(ADR-001/R5)?
   - 사이드바 LIVE 알약·홈 배너가 `live`에 의해서만 좌우되는가? `prefers-reduced-motion` 대체가 있는가?
   - SSE 훅이 폴링이 아니라 구독(골격)인가(R33)? 엔드포인트 부재 시 graceful한가?
   - 토큰만 사용했는가(hex 하드코딩 없음, R20)? 라이트/다크가 `[data-theme]`로만 전환되는가?
   - 레이아웃=RSC, 상호작용만 클라이언트인가(ADR-015)?
3. 결과에 따라 `phases/0-mvp/index.json`의 step6을 업데이트:
   - 성공 → `"completed"` + `"summary"`
   - 3회 실패 → `"error"` + `"error_message"`
   - 사용자 개입 필요 → `"blocked"` + `"blocked_reason"` 후 중단

## 금지사항

- **화면 컴포넌트에 `live` 상태를 보관하지 마라.** 이유: 배지·배너·룸이 어긋난다 — 앱 레벨 단일 소스(ADR-001/R5).
- **`live` 동기화를 폴링으로 구현하지 마라.** SSE 구독 골격으로(R33/ADR-014).
- **도메인 화면의 실제 내용(논문 분석·스케줄 보드·라이브 룸 등)을 만들지 마라.** 이유: 자리표시만. 실제 화면은 이후 step.
- **컴포넌트에 hex/raw 값 하드코딩 금지**(R20). 토큰만.
- **깜빡임·색만으로 LIVE를 전달하지 마라.** 텍스트 병행 + reduced-motion 대체(R29).
- **`tweaks-panel.jsx`를 포팅하지 마라**(R22).
- **`test`를 워치 모드로 두지 마라**(`vitest run`).
- 기존 테스트를 깨뜨리지 마라.
