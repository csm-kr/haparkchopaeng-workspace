# 사이드바 AI 연결·제공자·effort·업데이트 경험

입력: step0.md의 optional bridgeVersion/bridgeArchitecture, 기존 실제 provider models/reasoningEfforts.

UI 메모: 계정 위 AI 연결 진입점은 8px 상태 점과 텍스트로 둔다. connected는 online 토큰, 나머지는 회색 토큰이며 접근 가능한 상태 설명을 제공한다. 클릭하면 Codex/Claude Code 두 탭, 해당 제공자의 실제 모델과 지원 effort, 기존 20px 사용량 링을 보여준다. 탭 조회로 모델을 바꾸지 않고 명시적 모델 선택만 다음 질문에 적용한다.

하단은 실제 설치 버전과 게시된 호환 파일의 최신 버전을 비교한다. 구 앱의 미확인 버전을 최신으로 추정하지 않는다. 업데이트 받기 링크는 게시된 파일만 사용하며, 다운로드만으로 설치 완료 상태를 만들지 않는다. 설치 파일을 열어 기존 앱을 교체하고 AI 연결을 다시 누르는 안내를 준다. 최신·설치 버전이 더 높음·지원 파일 없음·조회 오류를 분리한다. Mac 칩 미확인은 명시적으로 선택한다.

TDD: connection-controls, bridge-release, bridge-update-info 테스트를 실패부터 실행한다. 검증: `node scripts/local-agent-verify.mjs all`.

임의 hex나 반경을 추가하지 마라. 이유: 기존 라이트·다크 토큰을 유지한다. 지원하지 않는 effort를 전달하거나 모델을 자동 대체하지 마라. 이유: 사용자가 선택한 실행 모델과 실제 CLI 계약을 보존한다.
