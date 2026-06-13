# Step 0: live-backend

라이브 세미나의 **서버 백엔드**를 만든다: Cloudflare Stream Live 클라이언트 + 라이브 데이터 접근 + route handler(start/join/leave/end/get/webhook). **이 step은 실시간 전파(Supabase Realtime)와 UI를 다루지 않는다** — 다음 step에서 한다.

> **Cloudflare 키는 placeholder(`xxxxxxxx`)다.** 키 없이 `next build`/`npm test`가 통과해야 한다(테스트는 Cloudflare fetch를 모킹). 실제 송출은 런타임에 진짜 키로만 동작 — 키 부재로 build/test가 막히면 안 된다.

## 읽어야 할 파일

먼저 아래 문서를 읽고 설계 의도를 파악하라. **정본은 루트 `README.md` · `CLAUDE.md` · `PRD.md`이며, 충돌 시 이를 따른다.** 고치지 말 것.

항상:
- `docs/dev/ARCHITECTURE.md` — 외부 경계(Cloudflare 위임)·route handler 책임
- `docs/agent/ADR.md` — **ADR-001(live=앱 전역 단일 상태)·ADR-002(Cloudflare Stream Live 위임)·ADR-015(읽기=RSC, 쓰기=route handler/Server Action)·ADR-016**
- `docs/dev/CODING_CONVENTION.md`

이 step:
- `docs/dev/API.md` — **§라이브 세미나 / §내부·웹훅**: `GET /api/live`·`/start`·`/:id/join`·`/:id/leave`·`/:id/end`·`/api/webhooks/cloudflare`. 권한(🔒/✍️)·응답 형태·상태코드(409 등) 그대로 구현.
- `docs/dev/SEQUENCE_DIAGRAM.md` — **S3(start)·S4(join/leave/end)·S4.6(녹화 웹훅)**
- `docs/dev/DB.md` + `prisma/schema.prisma` — `LiveSession`(active·presenterId·cloudflareLiveInputId·recordingUrl·startedAt·endedAt)·`Participant`(@@unique [liveSessionId, memberId]·leftAt)·`Job`
- `docs/security/SECURITY.md` — Stream Key는 발표자에게만·웹훅은 서명 검증
- `docs/agent/RULES.md` — R2(키 서버전용)·R3(세션에서 ID)·R5/R1(live 단일)·R34(서버리스)·R36(서명 자격증명)
- `.env.example` — `CLOUDFLARE_ACCOUNT_ID`·`CLOUDFLARE_STREAM_API_TOKEN`·`CLOUDFLARE_WEBHOOK_SECRET`

재사용(이미 존재 — 꼼꼼히 읽고 패턴/시그니처를 그대로 따른다):
- `lib/http.ts` — `ok(data, status?)`·`fail`·`HttpError(status, code, message)`·`toErrorResponse(e)`
- `lib/auth.ts` — `getSession()`·`requireAuth(): Promise<Session>`·`requireRole(...roles)`. `Session = { memberId, role }`. **세션에서 ID를 취하라(R3)**.
- `lib/prisma.ts` — `prisma`
- `lib/supabase/admin.ts` — `requireEnv` 패턴(호출 시점 env, 키 없이 build 통과). 같은 패턴으로 Cloudflare env를 읽어라.
- 기존 route handler 한 개(예: `app/api/papers/route.ts`)를 읽고 구조·zod·`toErrorResponse` 사용법을 맞춰라.

## 작업

### 1. Cloudflare Stream Live 클라이언트 — `lib/cloudflare.ts` (서버 전용)
- `requireEnv` 패턴으로 **호출 시점**에 `CLOUDFLARE_ACCOUNT_ID`·`CLOUDFLARE_STREAM_API_TOKEN`을 읽는다(모듈 로드 시 throw 금지 → 키 없이 build 통과, R2).
- `createLiveInput(): Promise<{ liveInputId: string; rtmps: { url: string; streamKey: string }; srt: { url: string; streamId: string; passphrase: string }; playback: { hls: string } }>` — Cloudflare API `POST /accounts/{id}/stream/live_inputs`(`fetch`, `Authorization: Bearer`). 응답에서 uid·rtmps·srt·playback(HLS) 추출. 녹화 모드(`recording: { mode: "automatic" }`) 설정.
- `deleteLiveInput(liveInputId): Promise<void>` — `DELETE /accounts/{id}/stream/live_inputs/{uid}`. 종료 정리.
- `verifyWebhookSignature(rawBody: string, signatureHeader: string | null): boolean` — `CLOUDFLARE_WEBHOOK_SECRET`로 HMAC 검증(타이밍 안전 비교). 세션 인증 아님.
- Cloudflare 비-2xx 응답은 명확한 에러로 throw(상위에서 5xx로 변환).

### 2. 라이브 데이터 접근 — `lib/live.ts`
- `getActiveSession(): Promise<{ id; presenterId; startedAt; participants: {...}[] } | null>` — Prisma 직접 조회(`where: { active: true }`, ADR-015). active 세션은 최대 1개.
- 필요한 파생/조회 헬퍼만. **여기서 Cloudflare를 호출하지 마라**(라우트가 조합).

### 3. route handler
모두 진입부에서 `requireAuth()`(웹훅 제외), 에러는 `toErrorResponse(e)`, 응답은 `ok(...)`/`fail(...)`.

- `GET /api/live` (`app/api/live/route.ts`) — `getActiveSession()` → `ok(session ?? null)`. **자격증명(streamKey 등) 미포함.**
- `POST /api/live/start` (`app/api/live/start/route.ts`) — `requireAuth`. 이미 active 세션이 있으면 `409`(`"이미 라이브가 진행 중이에요."`). 없으면 `createLiveInput()` → `LiveSession` 생성(`active: true`, `presenterId = session.memberId` **R3**, `cloudflareLiveInputId`). 응답 `ok({ session, rtmps, srt, playback }, 201)` — **Stream Key(rtmps.streamKey/srt.passphrase)는 발표자=호출자에게만**(SECURITY).
- `POST /api/live/:id/join` (`app/api/live/[id]/join/route.ts`) — `requireAuth`. `Participant` upsert(@@unique [liveSessionId, memberId], `leftAt: null`로 재참가 허용). 응답 `ok({ playback: { hls } })` — **재생용만, 송출 자격증명 절대 미포함**(Cloudflare에서 playback 조회 또는 세션에 저장해둔 값 사용).
- `POST /api/live/:id/leave` (`app/api/live/[id]/leave/route.ts`) — `requireAuth`. 본인 `Participant.leftAt = now`. **세션은 active 유지**(전역 종료 아님).
- `POST /api/live/:id/end` (`app/api/live/[id]/end/route.ts`) — **✍️ 발표자 본인 또는 관리자(👑)만**(presenterId === session.memberId || role 관리자, 아니면 403). `deleteLiveInput()` → `LiveSession.active = false`, `endedAt = now`. 응답 `ok({})`.
- `POST /api/webhooks/cloudflare` (`app/api/webhooks/cloudflare/route.ts`) — **세션 인증 아님**. `verifyWebhookSignature(rawBody, header)` 실패 시 `401`. 성공 시 녹화 완료 페이로드에서 해당 `LiveSession.recordingUrl` 기록(liveInputId 매칭). `ok({})`.

> Realtime broadcast(live.started/ended)는 **다음 step**에서 start/end에 붙인다. 이 step에선 broadcast 호출 자리를 비워두거나 TODO 주석만 남긴다 — 이 step에서 Supabase Realtime을 구현하지 마라.

## Acceptance Criteria

```bash
npm run build
npm test                 # vitest run — Cloudflare fetch·Prisma 모킹
npm run lint
```
단위 테스트(신규)는 최소 다음을 검증한다:
- `/start`: active 세션 존재 시 **409**, 없으면 생성 + presenterId가 **세션에서** 주입(클라 입력 무시, R3)
- `/start` 응답에는 streamKey 포함, `/join` 응답에는 **streamKey/송출 자격증명 미포함**(playback.hls만)
- `/leave`는 본인 Participant만 닫고 **세션 active 유지**, `/end`는 active=false (leave≠end)
- `/end`는 발표자/관리자만(타인 403)
- `verifyWebhookSignature`: 유효 서명 통과·위조 거부
- `lib/cloudflare`: 키 부재 시 **호출 시점**에 throw(모듈 로드 시 아님)

> 실제 송출/재생은 런타임에 진짜 Cloudflare 키로만 동작. 키 부재로 build/test가 불가하면 `blocked`(사유에 필요 키 명시).

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 아키텍처 체크리스트:
   - 동시 active 세션 1개가 강제되는가(409, ADR-001/R1)?
   - Stream Key가 발표자에게만 가는가(join에 미노출, SECURITY/R36)?
   - presenterId·participant memberId가 **세션에서** 오는가(R3)?
   - Cloudflare 키가 **호출 시점**에만 읽혀 키 없이 build 통과하는가(R2)?
   - 웹훅이 세션이 아니라 **서명**으로 보호되는가(S4.6)?
3. 결과에 따라 `phases/1-live/index.json`의 step0 업데이트:
   - 성공 → `"completed"` + `"summary"`(생성 파일·핵심 결정 한 줄)
   - 3회 실패 → `"error"` + `"error_message"`
   - 키/외부설정 필요로 build/test 불가 → `"blocked"` + `"blocked_reason"`(필요 항목) 후 중단

## 금지사항

- **Supabase Realtime broadcast·LiveProvider·UI를 이 step에서 만들지 마라.** 다음 step 범위다(scope 최소화).
- **Stream Key/송출 자격증명을 `/join`(시청자) 응답에 넣지 마라**(R36/SECURITY). 발표자 `/start`에만.
- **presenterId·memberId를 클라이언트 입력에서 받지 마라**(R3). 세션에서 주입.
- **모듈 로드 시점에 Cloudflare/웹훅 키를 강제로 읽어 throw하지 마라**(호출 시점, R2). 키 없이 build 통과해야 한다.
- **`/leave`가 세션을 전역 종료하게 하지 마라**(ADR-001). `/end`만 active=false.
- **route handler 밖(클라이언트)에서 Cloudflare를 호출하지 마라**(API.md 원칙).
- **`test` 워치 모드 금지**(`vitest run`). 기존 테스트를 깨뜨리지 마라.
