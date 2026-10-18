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

번호는 웹에만 표시한다. 웹은 attempt를 약 1초 간격으로 관측하고 connected를 받으면 device ID를 보관한다. 이전 시도/버전의 늦은 응답은 무시한다. 숫자 TTL 5분, 오답 최대 5회, 일회성 원자 소비.

## 연결기 API

| Method / path | Input | data |
| --- | --- | --- |
| POST `/desktop/ack` | `LocalAgentDesktopAckInput` | `LocalAgentDesktopAttempt` |
| POST `/desktop/pair` | `LocalAgentDesktopPairInput` | `LocalAgentDesktopAttempt` |
| POST `/desktop/heartbeat` | `{providers: LocalAgentProviderSnapshot[]}` | `LocalAgentDesktopHeartbeat` |
| POST `/desktop/claim` | `{}` | `LocalAgentClaim` or `null` |
| POST `/desktop/result` | `LocalAgentJobResultInput` | `{accepted:true,version:number}` |

heartbeat/claim/result는 `Authorization: Bearer <deviceToken>` 및 `X-Local-Agent-Device: <deviceId>` 헤더가 필요하다. deviceToken은 32 random bytes의 base64url(43자)이며 로컬 OS 암호화 저장소에 보관하고 서버는 SHA256 지문만 저장한다. 기존 키·같은 웹 세션·같은 팀·회수되지 않은 grant가 있으면 ack에서 자동 재연결한다. 이 조건이 없으면 앱에서 웹의 6자리 번호를 직접 입력해야 한다.

웹 heartbeat는 15초마다 현재 인증·팀·기기 grant를 확인해 45초 허가를 갱신한다. 연결기 heartbeat는 5초마다 상태/모델/한도를 올리고 현재 허가 만료와 취소 ID를 받는다. 연결기는 이를 갱신할 수 없다. 허가 만료·401/403이면 즉시 작업을 취소하고 새 claim을 중단한다. 웹 로그아웃·팀 변경은 즉시 서버 grant를 회수한다. 쿠키 삭제·웹 강제종료는 마지막 허가부터 최장 45초 뒤 차단된다.

작업은 DB에 queued로 기록하고 즉시 202 응답한다. 연결기는 claim을 2초 간격으로 요청하며, 유효한 grant의 자기 기기 작업 1개만 원자 claim한다. claimToken은 작업 결과 제출용 별도 자격이고 재사용된 requestId는 동일 작업을 돌려준다. 결과는 full accumulated response와 단조 증가 sequence를 전송한다. 같은/낮은 sequence는 중복으로 무시한다. 최종 상태 뒤 덮어쓰기·취소 후 응답·허가 만료 후 결과는 거절한다. 각 작업 최대 10분; 서버가 claim 시 전달하는 논문/분석 context와 질문만 사용한다.

모델은 heartbeat의 실제 카탈로그에서만 선택한다. quota가 없으면 null이며 잔여 토큰으로 계산하지 않는다. 공급자 로그아웃 상태에서는 이전 models/quota를 서버가 제거한다. observedAt 90초 이후는 이전 정보로 표시한다. status의 다른 PC 목록은 현재 PC라는 근거가 아니다. 현재 PC 확인은 새 attempt ACK 또는 이번 브라우저의 기존 연결 device hint를 통해 수행한다.

`quotaObservedAt?: ISO datetime`은 실제 한도 관측 시각이다. 모델·로그인 확인만 새로 했을 때 이 값을 갱신하지 않는다. 사용량 UI는 `quotaObservedAt ?? observedAt`을 사용하고, 모델 사용 가능성은 기존 provider `observedAt`을 따른다. `quota:null`이나 공급자 로그아웃이면 한도 관측 시각도 제거한다. 이 필드가 없는 기존 snapshot은 기존 관측 시각을 fallback으로 사용한다.

공급자 로그아웃·제거·한도 도달이나 모델 목록 삭제가 확인되면 해당 대기/실행 작업을 취소한다. 카탈로그가 오래된 대기 작업도 claim에서 건너뛰어 다른 공급자의 질문을 막지 않는다. heartbeat는 기기 행을 먼저 잠그고 관측 시각을 비교해 늦은 상태가 최신 로그아웃을 덮어쓰지 않게 한다. 팀 탈퇴·내보내기는 멤버십 삭제와 같은 트랜잭션에서 해당 팀의 연결 시도·기기·허가·작업·snapshot을 회수한다. 재가입하더라도 기존 기기 권한이 되살아나지 않으며 새 번호 확인이 필요하다.

실제 설치 파일 manifest는 배포 설정 경로로 별도 제공한다. 누락된 배포 파일을 다운로드 가능한 것으로 표시하지 않는다. v1은 외부상주 서버/WebSocket/Supabase service role을 연결기에 요구하지 않는다.
