# AI 브릿지 이름과 실제 설치 파일 안내

사용자가 앱 이름을 **AI 브릿지**로 확정했고, 운영 웹에서 설치 파일이 준비 중으로 표시되는 문제를 보고했다. 앞 단계의 `connector/desktop`, `components/local-agent`, `lib/local-agent-releases.ts`를 이어서 수정한다.

- 웹·창 제목·OS 앱 이름은 AI 브릿지로 맞춘다. 기존 `hapark-connect` 링크와 앱 ID, 서버 origin은 유지한다.
- 표시 이름 변경이 기존 OS 프로필·암호화 기기 키의 위치와 서비스명을 바꾸지 않아야 한다.
- 실제 배포한 파일만 manifest에 등록한다. `unsigned: true`인 테스트 버전은 다운로드 전에 게시자 서명이 없다고 표시한다. macOS의 ad hoc 서명과 Developer ID 게시자 서명을 구분한다.
- 운영 DB와 AI 실행 계약은 변경하지 않는다. 이유: 이번 문제는 설치 파일 배포와 이름·설치 안내에 한정된다.

각 변경은 실패 테스트부터 확인한다. manifest의 잘못된 자료형, 선택한 OS/아키텍처의 경고, 기존 프로필 보존을 검증한다.

## Acceptance Criteria

```text
node node_modules/vitest/vitest.mjs run lib/__tests__/local-agent-releases.test.ts lib/local-agent/__tests__/request.test.ts lib/local-agent/__tests__/prepared-jobs.test.ts app/api/local-agent/__tests__/routes.test.ts components/local-agent/__tests__/connection-widgets.test.tsx components/local-agent/__tests__/local-agent-flow.test.tsx --reporter=dot
node --test connector/test/*.test.mjs
node connector/scripts/mac-builder.test.mjs
```

`python scripts/execute.py 15-ai-bridge-preview --verify --step 0`으로 출력과 종료 코드를 기록한다. 이 단계 통과는 설치 파일 게시·서명·실제 운영 페어링 완료를 뜻하지 않는다. 설치 파일의 정확한 소스·해시·서명 여부와 다운로드 및 운영 웹 확인은 별도 배포 영수증에 남긴다.
