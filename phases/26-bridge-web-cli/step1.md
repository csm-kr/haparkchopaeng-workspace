# Step 1: server-terminal-request

## 읽어야 할 파일

먼저 아래 문서를 읽고 아키텍처와 설계 의도를 파악하라. **정본은 루트 `README.md` · `CLAUDE.md` · `PRD.md`이며, 충돌 시 이를 따른다.**

- `docs/dev/ARCHITECTURE.md`, `docs/agent/ADR.md`(ADR-034), `docs/dev/CODING_CONVENTION.md`, `docs/security/SECURITY.md`
- `lib/local-agent/PROTOCOL.md` — step 0에서 추가한 터미널 요청 계약
- `lib/local-agent/service.ts` — `desktopHeartbeat`, `deviceView`, `snapshotRows`, `BRIDGE_SNAPSHOT_PROVIDER`, `assertJobTarget`
- `lib/local-agent/validation.ts` — `BridgeMetadataSchema`, `HeartbeatSchema`
- `types/local-agent.ts`
- `app/api/local-agent/devices/[id]/route.ts`, `app/api/local-agent/desktop/heartbeat/route.ts`
- 테스트: `lib/local-agent/__tests__/service.integration.test.ts`, `app/api/local-agent/__tests__/`

## 작업

TDD: 통합 테스트와 route 테스트를 먼저 쓰고(RED) 구현한다.

1. 타입 (`types/local-agent.ts`)
   - `LocalAgentBridgeMetadata.bridgeCapabilities?: string[]`
   - `LocalAgentDeviceView.bridgeCapabilities?: "terminal_v1"[]` (fresh 관측일 때만, 아니면 `[]`)
   - `LocalAgentDesktopHeartbeat.terminalRequests?: { id: string; provider: LocalAgentProvider }[]`
   - `LocalAgentTerminalRequest { requestId: string; expiresAt: string }`
2. 검증 (`validation.ts`): `bridgeCapabilities: z.array(z.string().regex(/^[a-z0-9_]{1,32}$/)).max(8).optional()`. 알 수 없는 값은 거절하지 말고 저장 시 걸러낸다(앞으로 나올 앱과 호환). `TerminalRequestSchema = z.object({ provider: z.enum(["codex","claude"]) }).strict()`.
3. 서비스 (`service.ts`)
   - `_bridge` payload에 `bridgeCapabilities`(알려진 값 `terminal_v1`만)를 저장하고 `deviceView`가 fresh일 때 노출한다. `BridgeSnapshotSchema`는 이 필드를 optional로 받아 기존 행과 호환한다.
   - 새 예약 행 `TERMINAL_SNAPSHOT_PROVIDER = "_terminal"`: payload `{ version: 1, requests: { id, provider, expiresAt }[] }`. `snapshotRows`와 heartbeat의 `deleteMany notIn` 목록이 이 행을 CLI로 취급하거나 지우지 않게 한다.
   - `export async function requestTerminal(scope, deviceId, provider): Promise<LocalAgentTerminalRequest>`
     - 멤버십, 기기(같은 멤버·팀·미회수), 이번 세션의 사용 가능한 grant를 `assertJobTarget`과 같은 기준으로 확인한다. 실패 시 403 `PAIRING_REQUIRED`.
     - 기기가 online이고 fresh `_bridge`에 `terminal_v1`이 있어야 한다. 아니면 409 `CONNECTOR_UPDATE_REQUIRED`("터미널을 열려면 AI 브릿지를 업데이트해 주세요.").
     - 해당 provider snapshot이 없거나 `not_installed`이면 409 `PROVIDER_NOT_INSTALLED`.
     - 같은 provider의 미만료 요청이 있으면 그대로 돌려준다. 없으면 `randomUUID()` id, 만료 30초로 추가한다. 만료된 요청은 정리한다. 기기 행을 먼저 잠가(heartbeat와 같은 방식) 동시 요청이 서로 덮지 않게 한다.
   - `desktopHeartbeat`: 같은 트랜잭션에서 `_terminal` 행을 읽어 미만료 요청을 응답 `terminalRequests`로 돌려주고 행을 지운다. 이번 heartbeat 메타데이터에 `terminal_v1`이 없으면 전달하지 않고 지운다.
4. Route: `app/api/local-agent/devices/[id]/terminal/route.ts` `POST` — `webScope(req, true)`(origin 검사), `parseJson(req, TerminalRequestSchema)`, 202 응답. heartbeat route는 body의 `bridgeCapabilities`를 서비스로 넘긴다.

## Acceptance Criteria

```bash
NODE_OPTIONS=--no-experimental-webstorage npm run test:local-agent   # 격리 DB 통합 테스트 포함
npx tsc --noEmit
npm run lint
```

테스트가 확인할 것: 다른 멤버·팀·세션 거절, 구버전 앱(capability 없음) 409, 미설치 도구 409, 같은 도구 중복 요청은 같은 id, heartbeat가 한 번만 전달하고 두 번째 heartbeat에는 없음, 30초 지난 요청은 전달 안 됨, `_terminal` 행이 CLI 목록에 나오지 않음, `providers: []` heartbeat가 `_terminal`을 지우지 않음(전달 전), 외부 origin 403, body에 `command`·`args` 등 추가 필드 400.

## 검증 절차

1. AC 커맨드 실행. 2. CLAUDE.md CRITICAL(팀 스코핑·서버 주입·비밀) 확인. 3. index.json step 1 갱신.

## 금지사항

- 요청 payload에 provider 외의 값을 저장하거나 전달하지 마라. 이유: ADR-034 보안 경계.
- 새 테이블이나 컬럼을 만들지 마라. 이유: 운영 DB 수동 SQL이 필요해진다. 예약 snapshot 행을 쓴다.
- 기존 테스트를 깨뜨리지 마라.
