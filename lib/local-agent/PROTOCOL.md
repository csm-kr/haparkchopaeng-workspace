# Local connector REST v1

공유 DTO: `types/local-agent.ts`. 모든 응답은 기존 `{ data }` / `{ error: { code, message } }` 형식. API base는 `/api/local-agent`. 팀·멤버·웹 세션은 서버에서 결정한다. 웹 요청은 같은 origin의 JSON 요청이다.

## 웹 API

| Method / path | Input | data |
| --- | --- | --- |
| GET `/status?deviceId=...` | optional device hint | `LocalAgentStatus` |
| POST `/attempts` | `{}` | `LocalAgentAttemptCreated` (201) |
| GET `/attempts/:id` | — | `LocalAgentAttemptView` |
| DELETE `/attempts/:id` | — | `{ cancelled: true }` |
| POST `/web-heartbeat` | `{deviceId}` | `{leaseExpiresAt}` |
| DELETE `/devices/:id` | — | `{revoked:true}` |
| POST `/jobs` | `LocalAgentJobCreateInput` | `LocalAgentJobView` (202; requestId idempotent) |
| GET `/jobs/:id` | — | `LocalAgentJobView` |
| POST `/jobs/:id/cancel` | `{}` | `LocalAgentJobView` |

`POST attempts` 취소 전 새 시도를 만들면 같은 세션/팀의 이전 미완료 시도는 취소된다. `deepLink`는 `hapark-connect://connect?attemptId=...&launchToken=...`이며 번호·쿠키·CLI 인증은 포함하지 않는다. 설치 후 연결기에는 허용한 서버 origin 설정이 이미 있어야 한다. URI에서 임의 서버 주소를 받아 fetch하지 않는다.

Windows가 전용 링크의 authority 뒤에 루트 `/`를 추가할 수 있으므로 `hapark-connect://connect/?attemptId=...&launchToken=...`도 같은 연결로 해석한다. 등록한 scheme·`connect` host·빈 경로 또는 루트 경로만 허용하며, 사용자 정보·port·fragment·다른 경로·추가/중복 인자는 계속 거절한다. 토큰과 시도 ID 검증, 6자리 확인은 동일하다.

번호는 앱의 첫 ACK로 `awaiting_code`가 확인된 뒤 웹에만 표시한다. `awaiting_app`에서는 번호를 숨기고 설치·실행을 안내한다. 첫 ACK는 `expiresAt`을 현재 시각부터 5분과 로그인 세션 만료 중 이른 시각으로 설정한다. 같은 앱의 반복 ACK는 기존 만료 시각·실패 횟수·버전을 유지한다. 웹은 서버의 `expiresAt`으로 남은 초와 줄어드는 막대를 표시하고, 포커스 복귀 시 다시 계산한다. 만료 시 번호를 숨기고 새 연결을 요청하며 늦게 도착한 이전 응답은 무시한다. 웹은 attempt를 약 1초 간격으로 관측하고 connected를 받으면 device ID를 보관한다. 이전 시도/버전의 늦은 응답은 무시한다. 오답 최대 5회, 일회성 원자 소비.

## 연결기 API

| Method / path | Input | data |
| --- | --- | --- |
| POST `/desktop/ack` | `LocalAgentDesktopAckInput` | `LocalAgentDesktopAttempt` |
| POST `/desktop/pair` | `LocalAgentDesktopPairInput` | `LocalAgentDesktopAttempt` |
| POST `/desktop/heartbeat` | `LocalAgentDesktopHeartbeatInput` | `LocalAgentDesktopHeartbeat` |
| POST `/desktop/claim` | `{}` | `LocalAgentClaim` or `null` |
| POST `/desktop/result` | `LocalAgentJobResultInput` | `{accepted:true,version:number}` |

heartbeat는 기존 `providers` 외에 선택 필드 `bridgeVersion?: string`, `bridgeArchitecture?: "arm64" | "x64"`를 받는다. 새 앱은 실행 중인 `app.getVersion()`과 지원되는 `process.arch`만 보고한다. 버전은 최대 64자의 SemVer이며 prerelease/build를 허용하고 공백·`v` 접두사·명시적 `null`은 거절한다. 두 필드를 생략하는 기존 앱의 요청은 그대로 허용한다.

앱 정보는 기존 `LocalAgentSnapshot`의 서버 예약 provider `_bridge` JSON 행에 저장한다. 이 행은 CLI 목록·모델·한도에 포함하지 않으며 `providers: []`도 앱 정보를 지우지 않는다. 매 heartbeat에서 생략한 필드는 이전 보고를 이어 쓰지 않고 `null`로 기록한다. provider의 `observedAt` 역전 방지는 그대로 유지하며 앱 정보는 별도의 서버 수신 시각을 따른다. `LocalAgentDeviceView.bridgeVersion/bridgeArchitecture`는 현재 세션·팀의 유효한 grant와 20초 미만인 앱 heartbeat·메타데이터 관측이 모두 있을 때만 값을 반환하고, 미보고·오래된 값·권한 만료는 `null`이다. 설치파일의 무결성이나 최신 버전을 증명하는 값이 아닌 인증된 앱의 자기보고다. 기존 설치 파일과 호환되며 DDL 변경은 없다.

heartbeat/claim/result는 `Authorization: Bearer <deviceToken>` 및 `X-Local-Agent-Device: <deviceId>` 헤더가 필요하다. deviceToken은 32 random bytes의 base64url(43자)이며 로컬 OS 암호화 저장소에 보관하고 서버는 SHA256 지문만 저장한다. 기존 키·같은 웹 세션·같은 팀·회수되지 않은 grant가 있으면 ack에서 자동 재연결한다. 이 조건이 없으면 앱에서 웹의 6자리 번호를 직접 입력해야 한다.

웹 heartbeat는 15초마다 현재 인증·팀·기기 grant를 확인해 2분 허가를 갱신한다. 브라우저가 숨겨진 탭의 타이머를 약 1분에 한 번으로 늦춰도 갱신 사이에 만료되지 않게 하려는 값이다. 연결기 heartbeat는 5초마다 상태/모델/한도를 올리고 현재 허가 만료와 취소 ID를 받는다. 연결기에 주는 만료(`ack`·`pair`·heartbeat의 `leaseExpiresAt`)는 grant 안에서 최대 45초 앞까지만 보낸다. 0.1.9 이하 앱은 60초보다 먼 만료를 거절하기 때문이다. 연결기는 이를 갱신할 수 없다. 허가 만료·401/403이면 즉시 작업을 취소하고 새 claim을 중단한다. 웹 로그아웃·팀 변경은 즉시 서버 grant를 회수한다. 쿠키 삭제·웹 강제종료는 마지막 허가부터 최장 2분 뒤 차단된다.

작업은 DB에 queued로 기록하고 즉시 202 응답한다. 연결기는 claim을 2초 간격으로 요청하며, 유효한 grant의 자기 기기 작업 1개만 원자 claim한다. claimToken은 작업 결과 제출용 별도 자격이고 재사용된 requestId는 동일 작업을 돌려준다. 결과는 full accumulated response와 단조 증가 sequence를 전송한다. 같은/낮은 sequence는 중복으로 무시한다. 최종 상태 뒤 덮어쓰기·취소 후 응답·허가 만료 후 결과는 거절한다. 각 작업 최대 10분; 서버가 claim 시 전달하는 논문/분석 context와 질문만 사용한다.

모델은 heartbeat의 실제 카탈로그에서만 선택한다. quota가 없으면 null이며 잔여 토큰으로 계산하지 않는다. 공급자 로그아웃 상태에서는 이전 models/quota를 서버가 제거한다. observedAt 90초 이후는 이전 정보로 표시한다. status의 다른 PC 목록은 현재 PC라는 근거가 아니다. 현재 PC 확인은 새 attempt ACK 또는 이번 브라우저의 기존 연결 device hint를 통해 수행한다.

`quotaObservedAt?: ISO datetime`은 실제 한도 관측 시각이다. 모델·로그인 확인만 새로 했을 때 이 값을 갱신하지 않는다. 사용량 UI는 `quotaObservedAt ?? observedAt`을 사용하고, 모델 사용 가능성은 기존 provider `observedAt`을 따른다. `quota:null`이나 공급자 로그아웃이면 한도 관측 시각도 제거한다. 이 필드가 없는 기존 snapshot은 기존 관측 시각을 fallback으로 사용한다.

공급자 로그아웃·제거·한도 도달이나 모델 목록 삭제가 확인되면 해당 대기/실행 작업을 취소한다. 카탈로그가 오래된 대기 작업도 claim에서 건너뛰어 다른 공급자의 질문을 막지 않는다. heartbeat는 기기 행을 먼저 잠그고 관측 시각을 비교해 늦은 상태가 최신 로그아웃을 덮어쓰지 않게 한다. 팀 탈퇴·내보내기는 멤버십 삭제와 같은 트랜잭션에서 해당 팀의 연결 시도·기기·허가·작업·snapshot을 회수한다. 재가입하더라도 기존 기기 권한이 되살아나지 않으며 새 번호 확인이 필요하다.

실제 설치 파일 manifest는 배포 설정 경로로 별도 제공한다. 누락된 배포 파일을 다운로드 가능한 것으로 표시하지 않는다. v1은 외부상주 서버/WebSocket/Supabase service role을 연결기에 요구하지 않는다.

## 자유 대화와 추론 강도 확장 (2026-10-18)

REST v1의 ACK/pair/claim/result DTO는 유지한다. 자유 대화는 자료가 없어도 서버가 만든 `research_chat` JSON 문맥과 질문을 같은 claim 계약으로 전달하므로 기존 0.1.2가 실행할 수 있다. 논문·발표 자료의 준비 상태 `preparing`은 서버 내부에만 존재하며 기기는 `queued`만 claim한다. 준비도 활성 작업 상한과 취소·권한 회수에 포함한다.

실제 모델 카탈로그의 `reasoningEfforts?`는 확인된 `low|medium|high|xhigh|max` 값의 목록이다. 미제공이면 UI가 추론 강도를 표시·전송하지 않는다. 명시한 값은 입장과 claim 직전에 현재 카탈로그로 재검사하며, 지원 정보가 사라지면 안전하게 취소한다. 강도는 claim의 새 top-level 키가 아니라 서버 문맥의 `execution.effort`에 넣는다. 새 adapter만 이를 검증해 Codex `model_reasoning_effort` 또는 Claude `--effort`로 전달한다. 기존 앱에서 묵시적으로 지원한다고 표시하지 않는다.

새 필드를 받는 웹을 연결기보다 먼저 배포한다. 새 앱이 기존 strict 서버에 메타데이터를 보내면 거절될 수 있다. 기존 paperIds 배열과 새 version 2 Json 선택을 함께 읽는 호환 reader를 유지하며, 새 대화 데이터를 기록한 뒤에는 이전 배열 전용 서비스로 단순 롤백하지 않는다.


## Agent step capability (ADR-031)

provider snapshot은 `capabilities?: ["agent_step_v1"]`을 광고한다. 필드가 없는 기존 브릿지는 일반 채팅·분석을 계속 지원하지만 `purpose=agent_step`은 claim하지 못한다. 서버는 생성·enqueue·claim에서 capability와 최신 snapshot을 확인한다.

context는 `{version:1,kind:"agent_task",decisionContract,task,observation,results,previousDecisionInvalid,execution:{effort}}`다. 어댑터는 전용 JSON 행동 지침을 사용하고 기존 CLI 도구·셸·브라우저·MCP 제한을 유지한다. 모델에 쓰기 도구·검토 승인을 제공하지 않는다. 기존 grant·sequence·취소·실제 모델 카탈로그 계약을 따른다.
