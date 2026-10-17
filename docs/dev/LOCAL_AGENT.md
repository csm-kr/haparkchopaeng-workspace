# 로컬 AI 연결

운영 origin은 `https://hapark.vercel.app`이다. 웹의 **AI 연결** 버튼이 설치된 Electron 연결기를 `hapark-connect` 전용 링크로 연다. 연결기는 이 PC의 기존 Codex·Claude Code 로그인을 사용한다. 모델은 실제 CLI 목록에서 사용자가 선택하며 처음에는 비어 있다. 기존 Gemini/Inngest 논문 분석은 별도로 유지한다.

## 처음 설치와 다시 연결

1. 웹은 연결 요청과 전용 링크를 발급한다. 자동 앱 실행이 차단되면 실제 클릭 링크를 제공한다. 시간 초과만으로 미설치를 단정하지 않는다.
2. 처음에는 설치 파일을 내려받아 사용자가 OS 설치를 실행한다. 설치앱 첫 실행이 `/profile?localAgentResume=1`을 열어 로그인한 웹에서 연결 요청을 다시 전달받는다. 브라우저·OS의 확인은 생략할 수 없다.
3. 웹의 6자리 번호를 앱의 빈 입력창에 입력한다. 번호는 URI에 포함하지 않는다. 유효시간 5분, 오답 5회 제한, 일회 소비다.
4. 같은 로그인·팀·기기에서는 종료 후 웹 버튼으로 다시 열 때 번호를 반복 요구하지 않는다. 로그아웃·새 로그인·팀 변경 후에는 새 번호를 확인한다.
5. 설정의 AI 연결 카드에서 팀 논문·모델을 선택하고 질문한다. 논문 상세에 탭·사이드패널을 추가하지 않는다.

웹은 기존 테마·토큰, 앱은 다크 테마를 사용한다. 자동 시작·펫은 기본 해제다. 20px 사용량 링 상세는 hover/focus/touch에서만 열린다. 실제 기간·비율만 표시하고 미확인·90초 이상 오래된 값·0%를 구분한다. 구독 한도는 남은 토큰 수가 아니다. `quotaObservedAt`은 마지막 실제 한도 관측 시각으로, 모델 상태 갱신 때 갱신하지 않는다.

## 코드와 권한

| 경로 | 역할 |
|---|---|
| `types/local-agent.ts`, `lib/local-agent/PROTOCOL.md` | 공통 DTO·실제 REST 계약 |
| `lib/local-agent/**`, `app/api/local-agent/**` | 인증·팀·세션·페어링·durable DB 큐 |
| `components/local-agent/**` | 연결·설치·모델·사용량·연구 질문 UI |
| `connector/core/**` | CLI 탐색·제한 실행·JSONL·lease·취소·암호화 |
| `connector/desktop/**` | 전용 링크·단일 실행·다크 앱·선택형 펫 |

웹만 15초마다 45초 실행 허가를 갱신한다. 앱의 5초 heartbeat는 연장할 수 없다. 로그아웃·팀 전환·멤버 제거는 서버에서 요청·허가·작업을 회수한다. 쿠키 유실로 로그아웃 요청이 오지 않으면 최장 45초 뒤 만료된다. 앱은 실행 중 CLI를 취소하고 서버는 늦은 결과도 거절한다.

질문은 서버에서 활성 팀의 논문·실제 모델을 검증해 DB에 적재하고 202로 응답한다. 연결기가 claim한다. Vercel 요청 안에서 CLI나 지속 WebSocket을 실행하지 않는다. 논문 제목·저자·초록·기존 분석·figure 텍스트만 전달하고 저장소 키·PDF URL·로컬 경로·임의 사용자 파일은 전달하지 않는다.

기기 키는 32바이트 무작위 값이다. 서버는 해시, 앱은 OS 암호화 저장소로 보관한다. 안전한 Linux 비밀 저장소가 없으면 평문으로 대체하지 않는다. CLI 인증 파일은 복사·서버 전송하지 않는다. 사용자 설정·MCP·도구·프로젝트 지시를 차단한 제한 모드와 빈 임시 작업 폴더를 사용한다. 이는 CLI 기능 제한이며 OS 전체 격리를 실증한 것으로 표현하지 않는다.

## 환경·패키징

- `AUTH_SECRET`: 기존 로그인 서명 키. 없으면 관련 API는 한국어 503으로 안내한다.
- 서버 `LOCAL_AGENT_RELEASES`: 실제 배포한 설치 파일의 JSON 배열. 미설정은 `[]`이며 가짜 다운로드를 제공하지 않는다. 필드: `platform` (`windows`/`macos`/`linux`), `url` (HTTPS/같은 origin 절대 경로), `version`, 선택 `filename`, `architecture`.
- 앱 `CONNECTOR_APP_ORIGIN=https://hapark.vercel.app`: 설치 패키지에 허용 origin을 고정한다. localhost 개발 manifest는 배포를 거부한다.
- `npm --prefix connector/desktop ci` 뒤 해당 OS의 `package:win`, `package:mac`, `package:linux`를 실행한다. 서명·공증은 배포 환경에서 설정한다.
- 앱에 Node 런타임이 포함된다. 사용할 Codex/Claude Code CLI 자체는 PC에 설치·로그인되어 있어야 한다. 미설치·로그인 만료·버전 미지원·한도 상태를 안내한다.
- Ubuntu는 GUI 데스크톱과 안전한 비밀 저장소가 필요하다. Wayland의 창 위치·항상 위 표시에는 제약이 있다.

## 검증·운영 적용

```text
python scripts/execute.py 12-local-agent-connection --verify --step 0
npm run test:local-agent
npm run test:local-agent:wire
npm run test:local-agent:e2e
npm run test:isolated
npm run connector:test
npm run lint
npm run build
```

검증기는 전용 임시 SQLite URL과 빈 외부 키를 주입한다. 공유 운영 URL로 db push/seed하지 못하도록 경로·URL을 검사한다. 앱 검증 중에만 generated client를 SQLite로 바꾸고, 소유 서버 종료를 기다린 뒤 Postgres client를 복구한다. 다른 Prisma generate/개발 서버와 동시에 실행하지 않는다. 강제 종료로 lock이 남으면 소유 프로세스 부재를 확인한 뒤 lock을 정리하고 `npx prisma generate`로 복구한다.

공유 운영 DB의 새 테이블 적용은 ADR-020/022에 따라 사람이 [추가 전용 SQL](sql/20261017-local-agent-connection.sql)을 검토하고 수동 실행한다. 자동 검증은 운영 DB를 변경하지 않는다. 실제 설치 파일 배포 전에는 manifest를 채우지 않는다. 설계는 [LOCAL_AGENT_CONNECTION](../design/LOCAL_AGENT_CONNECTION.md), 상태는 `phases/12-local-agent-connection/index.json`을 따른다.

`.github/workflows/local-agent.yml`은 서비스 키 없이 전체 회귀·빌드·Chromium·HTTP 계약, 전용 PostgreSQL 16, Windows/macOS/Ubuntu의 연결기 테스트·설치 파일 빌드를 분리해 실행한다. CI의 미서명 패키지 생성은 실제 OS 설치·프로토콜 열기·Keychain/Secret Service·업데이트/제거 검증을 대신하지 않는다. Windows 네이티브 QA는 로그인된 CLI의 메타데이터를 읽지만 추론 요청은 보내지 않는다.
