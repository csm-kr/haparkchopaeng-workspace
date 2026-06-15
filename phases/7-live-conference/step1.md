# Step 1: livekit-token

라이브 백엔드를 Cloudflare Stream에서 **LiveKit 토큰 발급**으로 교체한다. `lib/livekit.ts`(토큰·룸)와 `lib/live-messages.ts`(데이터 채널 프로토콜)를 추가하고, 라이브 라우트 4종(`/start`·`/join`·`/leave`·`/end`)을 개조한다. **TDD** — 테스트 먼저.

## 읽어야 할 파일

먼저 아래 문서를 읽고 아키텍처와 설계 의도를 파악하라. **정본은 루트 `README.md` · `CLAUDE.md` · `PRD.md`이며, 충돌 시 이를 따른다.**

항상:
- `docs/dev/ARCHITECTURE.md` — 스택·디렉토리 구조
- `docs/agent/ADR.md` — 결정 근거. **특히 ADR-019(라이브=LiveKit, ADR-002 대체)·ADR-001·ADR-015·ADR-016**
- `docs/dev/CODING_CONVENTION.md` — 코드 규칙

데이터/API 레이어:
- `docs/dev/API.md` — 라이브 세미나(LiveKit) 엔드포인트 계약
- `docs/dev/DB.md` — 데이터 모델 규칙
- `docs/agent/RULES.md` — 특히 R1·R2·R3·R6·R7·R30·R33

인증/보안:
- `docs/security/SECURITY.md` · `docs/dev/ENV.md` — 비밀 취급(키는 호출 시점·서버 전용)

수정/참고할 기존 코드:
- `lib/cloudflare.ts` — **패턴 참고용**(`isLiveConfigured`·`requireEnv`·환경변수를 모듈 로드가 아니라 호출 시점에 읽는 규칙). 이 파일 자체는 step 4에서 삭제하므로 지우지 마라.
- `lib/live.ts` — `getActiveSession`(그대로 사용)
- `lib/realtime.ts` — `broadcastLive`·`LIVE_CHANNEL`(그대로 사용)
- `app/api/live/start/route.ts` · `app/api/live/route.ts` · `app/api/live/[id]/join/route.ts` · `app/api/live/[id]/leave/route.ts` · `app/api/live/[id]/end/route.ts` — 개조 대상
- `app/api/live/__tests__/live-routes.test.ts` — 새 계약으로 갱신
- `lib/http.ts`(`ok`/`fail`/`toErrorResponse`)·`lib/auth.ts`(`requireAuth`, 세션의 `memberId`·`role`)·`lib/prisma.ts`
- `types/entities.ts` — 공유 타입 추가 위치

이전 step에서 만들어진 코드/문서를 꼼꼼히 읽고, 설계 의도를 이해한 뒤 작업하라.

## 작업

### 0. 의존성

```bash
npm i livekit-server-sdk
```

(클라이언트 SDK `livekit-client`·`@livekit/components-react`는 step 2에서 설치한다.)

### 1. `lib/livekit.ts` (서버 전용)

**CRITICAL: 키는 모듈 로드가 아니라 호출 시점에 읽는다(R2)** — 키 없이 `npm run build`·`npm test`가 통과해야 한다. `lib/cloudflare.ts`의 `requireEnv`/`isLiveConfigured` 패턴을 그대로 따른다.

시그니처(내부 구현은 재량):

```ts
import { AccessToken, RoomServiceClient } from "livekit-server-sdk";

/** 키가 있고 placeholder가 아닌지 — 라우트가 503 안내 전에 확인. */
export function isLiveConfigured(): boolean; // LIVEKIT_URL·LIVEKIT_API_KEY·LIVEKIT_API_SECRET 모두 non-placeholder

/** wss:// 접속 URL — 클라가 LiveKit 룸에 연결할 주소. requireEnv("LIVEKIT_URL"). */
export function livekitUrl(): string;

/** 세션 id → 결정적 룸 이름. 예: `live-${sessionId}`. */
export function roomName(sessionId: string): string;

export interface IssueTokenOptions {
  sessionId: string;
  /** identity = Member.id. 반드시 세션에서 주입된 값(R3). */
  identity: string;
  name?: string;
  /** 발표자만 true — 화면공유 grant. */
  canPublishScreen: boolean;
}

/** 참가자별 LiveKit AccessToken(JWT) 발급. */
export async function issueAccessToken(opts: IssueTokenOptions): Promise<string>;

/** 세션 종료 시 LiveKit 룸 삭제(best-effort, 실패 무시). */
export async function deleteRoom(sessionId: string): Promise<void>;
```

구현 규칙:
- `issueAccessToken`: `new AccessToken(API_KEY, API_SECRET, { identity, name })` 후 `addGrant`:
  - `roomJoin: true`, `room: roomName(sessionId)`, `canPublish: true`, `canSubscribe: true`, `canPublishData: true`
  - `canPublishSources`: 발표자(`canPublishScreen`)면 `["camera","microphone","screen_share","screen_share_audio"]`, 아니면 `["camera","microphone"]`
  - 반환은 **`return await at.toJwt();`** — **CRITICAL: `toJwt()`는 Promise를 반환할 수 있다. 반드시 `await`.** (동기로 다루면 `[object Promise]` 토큰이 나간다.)
- `deleteRoom`: `new RoomServiceClient(livekitUrl 또는 https 호스트, API_KEY, API_SECRET).deleteRoom(roomName(sessionId))`를 `try/catch`로 감싼다. 실패는 삼킨다(세션은 이미 DB에서 비활성).
- **CRITICAL: 화면공유 grant는 `canPublishScreen=true`일 때만.** 시청자 토큰에 screen_share를 넣지 마라(R7).

### 2. `lib/live-messages.ts` (룸 데이터 채널 프로토콜 — 순수 함수, 외부 의존성 없음)

```ts
export type LiveMessage =
  | { kind: "chat"; text: string; at: number }
  | { kind: "reaction"; emoji: string; at: number }
  | { kind: "hand"; up: boolean; at: number };

/** LiveMessage → LiveKit publishData용 바이트(JSON + TextEncoder). */
export function encodeLiveMessage(m: LiveMessage): Uint8Array;

/** 바이트 → LiveMessage. 형식 위반/미지 kind는 null(방어적). */
export function decodeLiveMessage(bytes: Uint8Array): LiveMessage | null;
```

규칙:
- `chat.text`는 길이 상한(예: 500자)으로 clamp, 빈 문자열은 무시(null).
- **작성자(누가 보냈는지)는 메시지에 넣지 않는다.** 수신 측이 LiveKit 참가자 `identity`로 판별한다(R3 정신 — 페이로드의 author 미신뢰).
- 알 수 없는 `kind`·깨진 JSON·비-객체는 `null` 반환(throw 금지).

### 3. 라우트 개조

`POST /api/live/start` (`app/api/live/start/route.ts`):
1. `requireAuth()`.
2. `if (!isLiveConfigured()) return fail(503, "LIVE_UNCONFIGURED", "세미나 라이브가 아직 연결되지 않았어요. 관리자가 LiveKit 설정을 마치면 켜져요.")`.
3. `getActiveSession()` 있으면 `fail(409, "CONFLICT", "이미 라이브가 진행 중이에요.")`.
4. `prisma.liveSession.create({ data: { active: true, presenterId: session.memberId } })` — **`cloudflareLiveInputId`는 설정하지 않는다**(미사용 레거시).
5. `const token = await issueAccessToken({ sessionId: live.id, identity: session.memberId, canPublishScreen: true })`.
6. `await broadcastLive("live.started", { sessionId: live.id })` (실패 무시 — 기존 그대로).
7. `return ok({ session: { id, presenterId, startedAt }, token, url: livekitUrl() }, 201)`.

`POST /api/live/:id/join` (`app/api/live/[id]/join/route.ts`):
1. `requireAuth()`, `params.id`.
2. `if (!isLiveConfigured()) return fail(503, "LIVE_UNCONFIGURED", …)`.
3. 세션 조회 — 없거나 `!active`면 `fail(404, "NOT_FOUND", "진행 중인 라이브가 없어요.")`.
4. `prisma.participant.upsert(...)` 로 `leftAt: null` 등록(재참가 허용) — 기존 로직 유지(감사용).
5. `const token = await issueAccessToken({ sessionId: id, identity: session.memberId, canPublishScreen: false })`.
6. `return ok({ token, url: livekitUrl() })`.
   - **CRITICAL: 응답에 화면공유 grant 토큰을 주지 않는다(canPublishScreen:false). identity는 세션에서(R3).**

`POST /api/live/:id/leave` (`app/api/live/[id]/leave/route.ts`): **변경 없음**(본인 Participant `leftAt=now`).

`POST /api/live/:id/end` (`app/api/live/[id]/end/route.ts`):
1. 기존 권한 로직 유지(발표자 본인 또는 `session.role === "관리자"`, 아니면 403).
2. Cloudflare 호출 제거: `deleteLiveInput` 대신 `await deleteRoom(id)`(best-effort).
3. `prisma.liveSession.update({ active: false, endedAt })` 유지.
4. `await broadcastLive("live.ended", { sessionId: id })` 유지.

`GET /api/live` (`app/api/live/route.ts`): **변경 없음**.

> **import 정리:** 개조한 라우트에서 `@/lib/cloudflare` import를 제거한다(파일 자체는 step 4에서 삭제). `lib/cloudflare.ts`·`lib/whip.ts`는 이 step에서 **삭제하지 않는다** — 아직 컴포넌트(broadcast-panel/hls-player)가 import하고 있어 빌드가 깨진다.

### 4. 타입 (`types/entities.ts`)

라이브 토큰 응답 DTO를 공유 타입으로 추가(예: `LiveStartResponse`, `LiveJoinResponse`)하고 라우트·테스트에서 사용한다. `any` 금지.

## Acceptance Criteria

```bash
npm run build
npm test
```

테스트(먼저 작성):
- `lib/__tests__/livekit.test.ts`:
  - `isLiveConfigured`: 키 3종 존재/placeholder/누락 분기.
  - `issueAccessToken`: 반환 JWT의 payload(점 3개로 split → 가운데 base64url 디코드 JSON)에서 `sub`(=identity)·`video.room`(=`live-{id}`)·`video.roomJoin`·`video.canPublish` 확인. **발표자 토큰엔 `video.canPublishSources`에 `screen_share` 포함, 시청자 토큰엔 미포함**. (테스트는 `LIVEKIT_API_KEY`/`LIVEKIT_API_SECRET`를 더미 값으로 주입.)
  - 외부 dep 추가 없이 디코드(수동 base64url) — `jsonwebtoken` 등 새 의존성 설치 금지.
- `lib/__tests__/live-messages.test.ts`: encode→decode 왕복(chat/reaction/hand), 길이 clamp, 미지 kind·깨진 바이트 → `null`.
- `app/api/live/__tests__/live-routes.test.ts` 갱신:
  - `/start`: 미설정 503 · active 존재 409 · 성공 시 `token`+`url`+`session` 반환 · `presenterId`=세션값(클라 입력 무시, R3).
  - `/join`: 미설정 503 · 비active 404 · 성공 시 `token`+`url` · Participant upsert.
  - `/end`: 비발표자·비관리자 403 · 성공 시 active=false + `broadcastLive("live.ended")` 호출(목으로 확인) + `deleteRoom` 호출.
  - LiveKit·prisma·realtime은 적절히 목/주입한다.

## 검증 절차

1. 위 AC 커맨드 실행.
2. 아키텍처 체크리스트:
   - 모든 외부/DB 로직이 route handler·`lib/` 서버 함수에 있는가(R1)? 키를 호출 시점에 읽는가(R2)?
   - 토큰 identity가 세션에서 주입되는가(R3)? 화면공유 grant가 발표자에게만(R7)?
   - 동시 세션 1개(409)·`/end`만 전역 종료(R6)가 유지되는가?
   - `broadcastLive` 전이가 유지되는가(R33)?
3. `phases/7-live-conference/index.json`의 step 1 업데이트:
   - 성공 → `"completed"` + `summary`(생성 파일·핵심 결정 한 줄: lib/livekit.ts·lib/live-messages.ts·개조한 라우트·토큰 grant 규칙).
   - 3회 시도 후 실패 → `"error"` + `error_message`.
   - 키 발급 등 사람 개입 필요 → `"blocked"` + `blocked_reason`. (단, 이 step은 키 없이 통과해야 하므로 정상적으론 blocked가 아니다.)

## 금지사항

- **`lib/cloudflare.ts`·`lib/whip.ts`를 삭제하지 마라.** 이유: 아직 컴포넌트가 import 중 — step 4의 정리 단계에서 함께 지운다. 지금 지우면 빌드가 깨진다.
- **모듈 최상단에서 `process.env.LIVEKIT_*`를 읽지 마라.** 이유: 키 없이 build/test가 통과해야 한다(R2). 반드시 함수 호출 시점에 읽는다.
- **`toJwt()`를 `await` 없이 쓰지 마라.** 이유: Promise가 그대로 직렬화되면 깨진 토큰이 나간다.
- **시청자 토큰에 screen_share grant를 넣지 마라.** 이유: 화면공유는 발표자만(R7).
- **스키마(`prisma/schema.prisma`)를 수정하지 마라.** 이유: 이번 phase는 룸 이름을 id에서 파생하므로 변경 불필요 — 공유 운영 DB에 `db push`를 유발하지 않는다.
- 기존 테스트를 깨뜨리지 마라(개조한 라우트 테스트는 새 계약으로 갱신하되, 무관한 테스트는 건드리지 않는다).
