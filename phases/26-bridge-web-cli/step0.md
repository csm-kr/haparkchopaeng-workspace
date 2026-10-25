# Step 0: contract-docs

## 읽어야 할 파일

먼저 아래 문서를 읽고 아키텍처와 설계 의도를 파악하라. **정본은 루트 `README.md` · `CLAUDE.md` · `PRD.md`이며, 충돌 시 이를 따른다.**

- `docs/dev/ARCHITECTURE.md`, `docs/agent/ADR.md`(특히 ADR-031·ADR-033), `docs/dev/CODING_CONVENTION.md`
- `docs/security/SECURITY.md`
- `lib/local-agent/PROTOCOL.md` — 현재 웹·연결기 REST v1 계약
- `docs/design/AI_BRIDGE_PLATFORM.md` — "웹이 임의 셸 명령을 전달해 실행하는 기능은 공통 연결 계약에 포함하지 않는다" 원칙
- `docs/design/AI_CONNECTION_CONTROLS.md` — 연결 창 UX

## 작업

웹에서 연결된 PC의 CLI를 관리하는 두 기능의 계약을 문서로 먼저 고정한다. 코드는 바꾸지 않는다.

1. `docs/agent/ADR.md`에 **ADR-034 — 웹의 터미널 열기 요청과 실행 현황**을 추가한다.
   - 결정: 웹은 연결된 PC에 "Codex 또는 Claude Code 터미널을 열어 달라"는 요청만 보낼 수 있다. 요청에는 도구 이름(`codex`|`claude`)만 있고 명령·인자·경로·환경 변수는 없다. 앱은 자기가 찾은 CLI 실행 파일로 홈 폴더에서 터미널을 연다. 열린 터미널은 사용자가 관리하며 웹 연결 해제로 종료하지 않는다.
   - 전달: 서버 예약 snapshot 행 `_terminal`에 대기 요청을 두고, 다음 연결기 heartbeat 응답의 `terminalRequests`로 한 번만 전달한 뒤 지운다(at-most-once). 요청은 30초 뒤 만료된다. 같은 도구의 미전달 요청이 있으면 새로 만들지 않고 기존 요청을 돌려준다.
   - 앱 지원 표시: 앱은 heartbeat의 `bridgeCapabilities`에 `terminal_v1`을 보고한다. 서버는 이 표시가 20초 이내에 관측된 기기에만 요청을 받는다. 0.1.12 이하 앱에는 버튼을 숨긴다.
   - 실행 현황: 이번 웹 세션이 보낸 대기·실행 중 작업을 서버의 작업 기록에서 보여 준다. 앱의 별도 보고는 쓰지 않는다. 직접 연 터미널의 작업은 보여 주지 않는다. 멈추기는 AI 채팅 답변에만 제공하고, 논문 분석과 노트·세미나 작업은 각 화면으로 연결한다(각자 중단 절차가 있다).
   - DDL 변경 없음. 웹을 먼저 배포하고 앱을 나중에 게시한다(구 서버는 모르는 heartbeat 필드를 거절할 수 있다).
2. `lib/local-agent/PROTOCOL.md`에 위 계약을 추가한다: `POST /devices/:id/terminal` `{provider}` → `{requestId, expiresAt}` (202), `GET /jobs?active=1` → `LocalAgentActiveJobView[]`, heartbeat 입력 `bridgeCapabilities?: string[]`(알 수 없는 값은 저장하지 않음), heartbeat 응답 `terminalRequests?: {id, provider}[]`.
3. `docs/design/AI_BRIDGE_PLATFORM.md`의 원칙 문장 옆에 "임의 명령은 계속 금지하며, 고정된 도구의 터미널 열기 요청만 ADR-034로 허용한다"를 덧붙인다.
4. `docs/design/AI_CONNECTION_CONTROLS.md`에 연결 창의 "터미널 열기" 버튼과 "실행 중인 작업" 목록을 한 문단으로 추가한다.

## Acceptance Criteria

```bash
grep -n "ADR-034" docs/agent/ADR.md
grep -n "terminalRequests" lib/local-agent/PROTOCOL.md
grep -n "ADR-034" docs/design/AI_BRIDGE_PLATFORM.md
```

## 검증 절차

1. 위 커맨드가 각각 한 줄 이상 출력하는지 확인한다.
2. 문서끼리 숫자(30초, 20초, `terminal_v1`)가 일치하는지 확인한다.
3. `phases/26-bridge-web-cli/index.json`의 step 0을 갱신한다.

## 금지사항

- 웹이 명령·인자·경로를 보내는 계약을 쓰지 마라. 이유: 웹 세션 탈취가 곧 PC 원격 실행이 된다.
- 기존 ADR의 결정을 고쳐 쓰지 마라. 이유: ADR은 이력이다. 새 ADR로 보완한다.
