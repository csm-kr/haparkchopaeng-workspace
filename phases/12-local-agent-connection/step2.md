# Step 2: desktop-connector

관련 코드: `types/local-agent.ts`, `lib/local-agent/PROTOCOL.md`, `connector/core/**`, `connector/desktop/**`, `connector/test/**`.

기존 Codex/Claude CLI의 로그인으로 메타데이터·모델·사용량을 읽고 제한된 연구 질문을 실행한다. 사용자 설정·프로젝트 지시·도구·MCP·파일 확장으로 로컬 파일을 읽거나 쓰지 못하도록 제약하고 실제 CLI 버전으로 확인한다. 자식 프로세스는 숨기고 취소 시 트리를 정리한다. 네트워크 복구·권한 만료·provider 로그아웃·순서가 바뀐 결과를 안전하게 처리한다.

연결앱은 다크 UI, 빈 6자리 입력, OS 암호화 저장, 단일 실행, 등록 origin `https://hapark.vercel.app`, 전용 링크를 사용한다. 최초 설치 후에는 등록 웹의 복귀 URL을 열어 연결 요청을 받는다. 자동 시작·펫은 기본 해제한다.

AC: `node --test connector/test/*.test.mjs`

CLI 인증 파일을 서버에 전송하지 마라. 무인 추론을 반복하지 마라. 임의 URI origin을 허용하지 마라.
