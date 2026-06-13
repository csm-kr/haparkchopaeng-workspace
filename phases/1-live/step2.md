# Step 2: live-ui

라이브 세미나 **화면(룸)**을 만든다: `/meeting`의 자리표시(EmptyState)를 실제 룸으로 교체한다 — 빈 상태(라이브 없음 + 시작 CTA), 발표자 뷰(송출 자격증명 + 종료), 시청자 뷰(HLS 재생 + 퇴장), 참가자 목록. step0 API와 step1 `useLive()` 전역 상태에 연결한다.

> Cloudflare 키는 placeholder다. **키 없이 `next build`/`npm test`/E2E가 통과**해야 한다. 빈 상태·시작 버튼·권한 분기·상태 3종은 키 없이 검증 가능. 실제 송출/재생 화면은 런타임에 진짜 키로만 채워진다 — 키 부재 시 플레이어는 "연결을 기다리는 중" 등 graceful 상태.

## 읽어야 할 파일

먼저 아래를 읽고 설계 의도를 파악하라. **정본은 루트 `README.md`·`CLAUDE.md`·`PRD.md`. 고치지 말 것.**

항상:
- `docs/agent/ADR.md` — **ADR-001(live 단일·/end만 전역 종료)·ADR-002(Cloudflare 위임)·ADR-015**
- `docs/design/DESIGN_GUIDE.md` — **토큰만 사용(R20), 색+텍스트 병행(R29), prefers-reduced-motion, 상태 3종**
- `docs/dev/CODING_CONVENTION.md`

이 step:
- `docs/design/SCREENS.md` — **§세미나 라이브**: 빈 상태 카피·발표자/시청자 룸 구성·참가자 표시·종료 확인
- `docs/design/SCREEN_FLOW.md` — 라이브 진입/입장/나가기/종료 전환·조건부 UI
- `docs/dev/API.md` — §라이브 세미나 응답 형태(start: rtmps/srt/playback, join: playback.hls만)
- `docs/dev/SEQUENCE_DIAGRAM.md` — S3·S4·S4.5
- `docs/agent/RULES.md` — R5/R1(live 단일·화면 미보관)·R26(상태 3종)·R27(파괴적 액션=종료 확인)·R29(색+텍스트)·R30(따뜻한 에러 카피)·R20(토큰)

이전 step 산출물(연결):
- `app/api/live/route.ts`(GET 현재 세션)·`/start`·`/:id/join`·`/:id/leave`·`/:id/end` — fetch로 호출(클라이언트 섬, R32). DB·Cloudflare 직접 호출 금지(API.md 원칙).
- `lib/live.ts` `getActiveSession()` — page(RSC) 초기 데이터.
- `components/providers/live-provider.tsx` `useLive()` — 전역 `live`/`setLive`. 시작/종료 시 낙관적 `setLive` + Realtime이 확정.

기존 코드(패턴 유지):
- `app/(app)/meeting/page.tsx` — **현재 자리표시.** RSC로 교체.
- `app/(app)/library/loading.tsx`·`components/library/*` 등 — 기존 화면의 RSC + loading.tsx + try/catch 에러카드 + 'use client' 인터랙티브 섬 패턴을 그대로 따른다.
- `components/shell/live-banner.tsx` — TODO된 "라이브 룸으로 이동" 링크를 `/meeting`으로 연결.
- `components/ui/*`(Button/Card/Badge/Avatar/EmptyState) 재사용.

## 작업

### 1. `app/(app)/meeting/page.tsx` (RSC)
- `getActiveSession()`으로 현재 세션을 구해 `<LiveRoom>`에 props로 전달(ADR-015).
- `Topbar crumbs={[{ label: "세미나 라이브" }]}`.
- try/catch 에러카드 + `loading.tsx` 스켈레톤(상태 3종, R26).

### 2. `components/live/live-room.tsx` ('use client' 섬)
전역 `useLive()`의 `live`와 서버 props를 함께 본다(첫 렌더 정확 + 전이 반영). 분기:
- **라이브 없음**: EmptyState("아직 진행 중인 세미나가 없어요") + **[라이브 시작]** 버튼 → `POST /api/live/start`. 성공 시 `setLive(true)`(낙관적) + 발표자 뷰로. 409면 따뜻한 카피("이미 라이브가 진행 중이에요 — 입장할까요?") + 입장 동선(R30).
- **라이브 중 · 내가 발표자**(presenterId === 내 memberId): 송출 안내 카드 — RTMPS URL/Stream Key·SRT를 **복사 버튼**으로(자격증명은 발표자 본인에게만). **[라이브 종료]** 버튼 → 확인 다이얼로그(파괴적, R27) → `POST /api/live/:id/end` → `setLive(false)`.
- **라이브 중 · 시청자**: 마운트 시 `POST /api/live/:id/join` → `playback.hls`로 플레이어. **[나가기]** → `POST /api/live/:id/leave`(전역 종료 아님). 송출 자격증명 미표시.
- **참가자 목록**: Avatar + 이름(현재 접속자). 색+텍스트로 발표자/시청자 구분(R29).

### 3. HLS 플레이어 — `components/live/hls-player.tsx`
- `playback.hls` URL을 재생. Safari 등 네이티브 HLS는 `<video src>`, 그 외는 동적 import한 `hls.js`로 attach. **`hls.js`를 의존성에 추가**(npm install hls.js + @types 불필요 시 무시). URL이 없거나(키 부재) 로드 실패 시 graceful 플레이어 자리("연결을 기다리는 중" / "재생을 시작할 수 없어요" + 다시 시도, R30) — 던지지 말 것.
- `prefers-reduced-motion` 존중, 컨트롤은 토큰 색(R20/R29).

### 4. 배너 링크
- `components/shell/live-banner.tsx`의 TODO 링크를 `/meeting`으로 연결(라이브 중일 때 룸 진입).

## Acceptance Criteria

```bash
npm run build
npm test                 # vitest run — RTL: 분기·권한·낙관적 전이(fetch 모킹)
npm run lint
npx playwright test      # E2E
```
- 단위(RTL, 신규): 라이브 없음→시작 버튼·빈 카피 / 발표자 뷰=자격증명+종료(확인 다이얼로그) / 시청자 뷰=자격증명 미표시+나가기 / 시작 409→입장 안내 / 플레이어 URL 부재 graceful.
- E2E(신규 1, 핵심경로): 로그인 → `/meeting` → **라이브 없음 빈 상태 + [라이브 시작] 노출**(키 없이 가능한 경로). 실제 송출은 검증 대상 아님.

> 실제 송출/재생은 런타임에 Cloudflare 키로만. 키 부재로 build/test/E2E가 불가하면 `blocked`.

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 체크리스트:
   - `live`를 화면 상태로 보관하지 않고 `useLive()` 전역만 쓰는가(ADR-001/R5)?
   - 시청자 뷰에 **송출 자격증명이 절대 안 보이는가**(발표자만, SECURITY)?
   - 종료가 확인을 거치는 파괴적 액션인가(R27)? `/leave`는 본인만(전역 종료 아님)?
   - 상태 3종(로딩·빈·에러)·색+텍스트·토큰만(R26/R29/R20)?
   - 클라이언트가 DB/Cloudflare를 직접 부르지 않고 route handler만 fetch하는가(API.md)?
3. `phases/1-live/index.json`의 step2를 업데이트(성공/error/blocked, 이전 step과 동일 규칙). 이게 마지막 step이면 phase 완료.

## 금지사항

- **시청자에게 Stream Key/송출 자격증명을 보여주지 마라**(SECURITY). 발표자 본인 뷰에만.
- **`live`를 화면 컴포넌트 state로 만들지 마라**(ADR-001/R5). `useLive()` 전역만.
- **[라이브 종료]를 확인 없이 실행하지 마라**(파괴적, R27). `/leave`와 `/end`를 혼동하지 마라.
- **클라이언트에서 DB/Cloudflare를 직접 호출하지 마라**(API.md). route handler fetch만.
- **HLS URL/키 부재 시 throw하지 마라**(graceful 플레이어 상태, R30).
- **하드코드 색/임의 hex 금지**(토큰만, R20). 모션은 reduced-motion 존중(R29).
- **`test` 워치 모드 금지**(`vitest run`). 기존 테스트를 깨뜨리지 마라.
