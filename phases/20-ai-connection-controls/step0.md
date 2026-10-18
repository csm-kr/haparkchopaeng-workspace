# 실제 앱 버전과 CLI capability 전달

기준: README.md, docs/user/PRD.md, lib/local-agent/PROTOCOL.md, connector/core/runtime.mjs.

웹과 설치 앱 버전은 다르다. app.getVersion()/process.arch를 optional heartbeat metadata로 보고한다. 기존 snapshot의 예약 metadata row를 사용해 DDL 없이 저장하고 현재 인증·팀·실행 허가와 신선도를 지킨다. 구 앱이 미제공한 버전은 null이다. 실제 Claude 초기화 모델의 supportedEffortLevels/supportsEffort를 읽되 미제공 모델에는 값을 만들지 않는다. 버전 0.1.5와 정적 앱 식별자·등록 프로토콜·프로필 경로를 유지한다.

실패 테스트를 먼저 실행한 뒤 구현한다. 검증: `node --test connector/test/*.test.mjs`, phase step1의 전체 웹 회귀 및 exact-source CI PostgreSQL.

원본 dirty checkout의 파일·index를 변경하지 마라. 이유: 이 기능과 관계없는 사용자 작업을 보존해야 한다. 실제 구독 추론으로 capability를 탐색하지 마라. 이유: CLI 초기화 metadata만으로 지원 범위를 알 수 있다.
