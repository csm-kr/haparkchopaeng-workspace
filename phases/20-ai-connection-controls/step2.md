# 배포 및 설치 업데이트 검증

입력: step0/step1 산출물과 부모가 수집한 RED/GREEN 기록.

검증은 lint, production build, Chromium 흐름, 실제 HTTP wire를 순차 실행한다. 정확한 소스로 PR 및 태그 CI를 완료한다. 웹의 optional metadata 수용을 먼저 배포하고 동일 소스 앱 0.1.5 Windows/Mac/Ubuntu 파일을 게시·무인증 해시 검증한 뒤 운영 다운로드 manifest를 변경한다.

현재 PC의 0.1.2 설치와 신규 파일의 정적 identity/profile/protocol이 같은지 확인한다. 사용자 작업이 없는 상태에서 정상 업그레이드를 검증하고 실제 heartbeat의 0.1.5·architecture와 운영 웹의 버전 비교·상태점·제공자 모델·effort UI를 Aside로 확인한다. 단순 다운로드를 설치 완료로 보고하지 않는다. 기존 로그인·팀·기기 인증 경계와 6자리 확인 정책을 유지한다.

원본 dirty checkout이나 env를 배포하지 마라. 이유: 운영에는 검증한 source만 반영해야 한다. 자동 회귀에서 실제 구독 추론을 수행하지 마라. 이유: fixture 검증과 승인된 소량 운영 smoke를 구분해야 한다.
