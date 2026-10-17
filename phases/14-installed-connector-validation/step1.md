# 실제 설치 파일과 OS 전용 링크 검증

## 입력

- `step0.md`의 링크 오류 보존 수정
- `connector/desktop/package.json`의 DMG·.deb와 `.github/workflows/local-agent.yml`
- 기존 `connector/scripts/ci-desktop-smoke.mjs`의 unpackaged 암호화·페어링 근거

## 구현과 AC

- macOS·Ubuntu·Windows의 일회용 GitHub runner에서만 실행한다. 기존 동일 앱 설치와 핸들러 충돌은 덮어쓰지 않고 실패한다. Windows의 기존 로컬 설치 QA는 GUI 실행을 추가하지 않으며, 명시한 hosted CI에서만 설치 앱의 URI 검증을 실행한다.
- 패키지와 설치 경로를 검증하고 설치한 core가 후보 소스와 일치하는지 확인한다.
- 실제 설치 앱 시작과 OS 전용 링크 전달, 잘못된 연결 링크의 오류 UI 유지, 같은 인스턴스 재사용, 종료·제거를 관측한다.
- origin을 완화하거나 TLS·sandbox·암호화 경계를 우회하지 않는다. 잘못된 URI는 API 이전에 거절하므로 AI 작업과 운영 API 호출은 0이어야 한다.
- 위험 경로·플랫폼·runner·패키지 사전 조건과 진단 출력의 단위 검증을 먼저 만든다.
- 이 단계의 구현 AC는 `node --test connector/test/*.test.mjs`와 구문 검사다. Windows 하네스는 npm 명령 파일을 셸로 실행하지 않고 Node를 직접 호출한다. runner·설치 경계, 번들 이름, 경로 별칭, PID 소유권과 관측 실패, 원문 없는 진단의 회귀를 포함한다. 설치·전용 링크·제거의 실제 OS 통과 판정은 `step2.md`의 원격 CI gate에서만 한다.

## 검증 범위

미서명 CI 설치는 실제 사용자 브라우저의 외부 앱 허용 창, 다운로드 quarantine/Gatekeeper, 서명·공증, 실제 운영 페어링을 증명하지 않는다. 결과마다 이 한계를 명시한다.

## 금지

로컬 사용자 PC에 이 smoke를 실행하지 마라. 이유: OS 설치·기본 프로토콜 등록·제거는 일회용 runner 전용이다.

기존 설치·사용자 데이터·암호화 저장소를 삭제하지 마라. 이유: 검증 소유 경로만 정리할 수 있다.
