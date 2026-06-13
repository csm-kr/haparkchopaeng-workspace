# Step 1: live-realtime

라이브 전이를 **Supabase Realtime**으로 전파한다: 서버(start/end)가 채널에 broadcast하고, 클라이언트(LiveProvider)가 그 채널을 구독해 `live` 앱 전역 상태를 갱신한다. **폴링이 아니라 푸시**(R33/ADR-014→016). 기존 LiveProvider의 SSE 골격을 Supabase Realtime 구독으로 교체한다.

> Supabase 키는 placeholder일 수 있다. **키 없이 `next build`/`npm test`가 통과**해야 하고, 키/연결 부재 시 구독은 **graceful no-op**(에러 없이 조용히)이어야 한다(기존 SSE 골격과 동일한 안전성).

## 읽어야 할 파일

먼저 아래를 읽고 설계 의도를 파악하라. **정본은 루트 `README.md`·`CLAUDE.md`·`PRD.md`. 고치지 말 것.**

항상:
- `docs/agent/ADR.md` — **ADR-001(live=앱 전역 단일)·ADR-014→016(Supabase Realtime, SSE/폴링 아님)·ADR-015**
- `docs/dev/ARCHITECTURE.md` — §실시간(Supabase Realtime)
- `docs/dev/CODING_CONVENTION.md`

이 step:
- `docs/dev/SEQUENCE_DIAGRAM.md` — **S4.5(라이브 전이 실시간 전파)**: 클라가 `live` 채널 구독, 서버가 `live.started`/`live.ended` broadcast → 사이드바 배지·홈 배너·룸 동시 갱신
- `docs/dev/API.md` — §라이브 세미나의 "(구독) Supabase Realtime 채널" 행, "전이 전파는 Supabase Realtime으로" CRITICAL
- `docs/agent/RULES.md` — **R33(Supabase Realtime 푸시, 폴링 금지)**·R5/R1(live 단일·화면 미보관)·R2(service role 서버전용)·R34

이전 step(0) 산출물(재사용/연결):
- `app/api/live/start/route.ts` — 생성 성공 직후 `live.started` broadcast 추가
- `app/api/live/[id]/end/route.ts` — 종료 직후 `live.ended` broadcast 추가
- `lib/live.ts` — `getActiveSession()`

기존 코드(꼼꼼히 읽고 패턴 유지):
- `components/providers/live-provider.tsx` — **현재 SSE 골격(`useLiveStream`).** 이걸 Supabase Realtime 구독으로 교체한다. `LiveProvider({ children, initialLive })`·`useLive()` **공개 시그니처는 유지**(소비자 깨지면 안 됨).
- `app/(app)/layout.tsx` — RSC 인증 가드·멤버 props. 여기서 `initialLive`를 서버에서 주입(아래 4).
- `lib/supabase/server.ts`·`lib/supabase/admin.ts` — Supabase 클라이언트 패턴(호출 시점 env). `@supabase/supabase-js` 이미 설치됨.

## 작업

### 1. 서버 broadcast 헬퍼 — `lib/realtime.ts` (서버 전용)
- `broadcastLive(event: "live.started" | "live.ended", payload?: Record<string, unknown>): Promise<void>` — `createSupabaseAdmin()`로 `channel("live")`에 `send({ type: "broadcast", event, payload })`(또는 `.realtime` 채널 broadcast). 채널 이름 상수는 클라와 공유할 수 있게 한 곳에 export(예: `export const LIVE_CHANNEL = "live"`).
- **graceful**: Supabase 키 부재/전송 실패는 **삼킨다**(throw 금지) — 전이 전파 실패가 start/end API를 실패시키면 안 된다. (실패는 console.warn 정도.)
- service role 키는 **서버 전용·호출 시점**(R2).

### 2. start/end에 broadcast 연결
- `POST /api/live/start`: `LiveSession` 생성 성공 후 `await broadcastLive("live.started", { sessionId })`(실패 무시).
- `POST /api/live/:id/end`: 종료 성공 후 `await broadcastLive("live.ended", { sessionId })`(실패 무시).
- **분석/긴 작업이 아니므로 인라인 호출이 맞다**(Inngest 아님). broadcast는 즉시성이 핵심.

### 3. LiveProvider를 Supabase Realtime 구독으로 교체
- `lib/supabase/browser.ts`(신규, 클라이언트용): `createBrowserSupabase()` — `NEXT_PUBLIC_SUPABASE_URL`·`NEXT_PUBLIC_SUPABASE_ANON_KEY`로 브라우저 클라이언트 생성. **anon 키만**(공개 OK), service role 절대 금지(R2). 키 부재 시 `null` 반환(throw 금지).
- `components/providers/live-provider.tsx`: `useLiveStream`(SSE) **제거**, 대신 `useLiveRealtime(setLive)` — `LIVE_CHANNEL` 구독, `live.started`→`setLive(true)`, `live.ended`→`setLive(false)`. 클라이언트가 `null`이면(키 없음) 조용히 no-op. 언마운트 시 `removeChannel`로 정리(재연결 폭주 방지).
- **폴링/`setInterval` 금지(R33).** EventSource도 제거.
- `LiveProvider`/`useLive`의 공개 시그니처·`live`/`setLive` 계약은 그대로.

### 4. 서버에서 initialLive 주입
- `app/(app)/layout.tsx`: `getActiveSession()`으로 현재 live 여부를 구해 `<LiveProvider initialLive={!!active}>`로 전달. 첫 렌더부터 배지/배너가 정확하고, 이후 전이는 Realtime이 갱신한다(ADR-001 — 모두에게 일관).

## Acceptance Criteria

```bash
npm run build
npm test                 # vitest run — Supabase 채널 모킹
npm run lint
```
단위 테스트(신규)는 최소:
- `broadcastLive`: Supabase 미설정/전송 실패 시 **throw하지 않는다**(graceful)
- `LiveProvider`: `live.started` 수신 → `useLive().live === true`, `live.ended` → `false`(채널 모킹)
- `initialLive` prop이 초기 상태에 반영된다
- 브라우저 클라이언트는 **anon 키만** 쓴다(service role 미참조)

> 실제 푸시는 런타임에 Supabase 프로젝트(Realtime 활성) + 키로 동작. 단위 테스트는 채널을 모킹한다.

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 체크리스트:
   - 전이가 **폴링 아니라 Realtime 푸시**인가(SSE/`setInterval` 제거, R33)?
   - `live`가 앱 전역 단일 상태로 유지되고 화면에 안 박히는가(ADR-001/R5)?
   - service role이 클라이언트에 노출되지 않는가(브라우저=anon만, R2)?
   - 키 부재 시 graceful(빌드·런타임 에러 없음)인가?
3. `phases/1-live/index.json`의 step1을 업데이트(성공/error/blocked, step0과 동일 규칙).

## 금지사항

- **폴링·`setInterval`·SSE로 전이를 받지 마라.** Supabase Realtime 구독만(R33/ADR-014→016).
- **service role 키를 브라우저/클라이언트 번들·`NEXT_PUBLIC_`에 노출하지 마라**(R2). 브라우저는 anon 키만.
- **broadcast 실패가 start/end API를 실패시키게 하지 마라**(graceful, 전이 전파는 best-effort).
- **`LiveProvider`/`useLive` 공개 시그니처를 바꾸지 마라**(기존 소비자: 사이드바·배너·layout이 깨진다).
- **live를 화면 컴포넌트 상태로 옮기지 마라**(ADR-001/R5).
- **UI(meeting 화면·룸·플레이어)를 이 step에서 만들지 마라** — 다음 step.
- **`test` 워치 모드 금지**(`vitest run`). 기존 테스트를 깨뜨리지 마라.
