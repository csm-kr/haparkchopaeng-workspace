# Intel Mac의 실제 설치·실행 검증

기존 `step2.md`의 제품 `c808e926` 및 공통 `1e309c3f` 검증은 Mac arm64 실제 실행과 x64 DMG 생성만 증명했다. 후속 문서 커밋 `86b98d8` 및 `2fad9a9`의 CI도 같은 범위다. Intel 실행을 확인하기 위해 현재 지원하는 표준 x64 runner를 사용한다.

공식 [GitHub-hosted runners reference](https://docs.github.com/en/actions/reference/runners/github-hosted-runners)의 private repository 표는 `macos-15-intel`을 Intel runner로, `macos-15`를 arm64 runner로 구분한다. Aside로 해당 문서의 전체 `main` snapshot을 확인했다.

- 제품 `.github/workflows/local-agent.yml`과 공통 저장소 `.github/workflows/validate.yml`에 실제 아키텍처를 구분한 Intel 행을 추가한다.
- 테스트 전 Node의 실제 `process.arch`와 GitHub `RUNNER_ARCH`를 matrix 기대값과 대조한다. 누락·불일치 때 실패해야 한다.
- Mac 두 행의 capture·installed evidence·installer artifact 이름이 충돌하지 않도록 아키텍처를 포함한다.
- 기존 네이티브 암호화·페어링/재개 13조건과 실제 설치본 DMG·OS URI·cold/warm·정상 종료·재실행·전체 정리 9조건을 동일하게 실행한다. x64 DMG는 해당 Intel job에서 선택·설치한 파일의 해시를 기록한다.
- app/core·서명 정책·암호화·권한 경계·CLI 추론은 변경하지 않는다. 운영 SQL이나 실제 CLI 요청도 실행하지 않는다.
- YAML parsing, 아키텍처 guard의 정상/불일치/미설정 종료 코드와 해당 후보 CI를 확인한다. 단순 CI 구성 확인을 위한 별도 영구 모듈은 추가하지 않는다.
- 두 저장소의 실제 Intel job 결과가 확인된 다음에만 이 step의 AC `python -X utf8 -m pytest scripts/test_execute.py -q`를 하네스로 실행하고 완료로 기록한다.
- 이전 영수증·이미지·검증 JSON을 보존하고 Intel 실제 실행 결과를 별도 절로 추가한다. 서명·공증·Gatekeeper·실사용자 브라우저 설치·운영 페어링·재부팅/업데이트의 미완료 상태는 유지한다.
