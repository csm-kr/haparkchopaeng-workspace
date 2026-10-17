# 처음 연결 링크의 오류 보존

## 근거와 입력

- `connector/desktop/main.mjs`, `connector/core/lifetime.mjs`, `connector/test/lifetime.test.mjs`
- packaged cold start의 링크 처리가 실패하면 `attempt`가 없고 큐는 비어 최초 웹 열기 조건이 다시 참이 된다. 이 경우 오류 화면을 idle 안내로 덮는다.

## 구현과 AC

1. 링크를 받은 첫 실행은 유효·잘못됨·만료 여부와 관계없이 최초 자동 웹 열기를 수행하지 않는다. 정상 최초 수동 앱 실행은 기존 웹 복귀를 유지한다.
2. macOS early `open-url`, CLI argv, 두 번째 프로세스에서 받은 URL을 모두 추적한다.
3. 기존 프로필·웹 origin·sandbox·개발 전용 옵션의 경계를 바꾸지 않는다.
4. 실패 테스트부터 만들고 `node --test connector/test/lifetime.test.mjs`를 통과시킨다. 동일 정책을 공통 repo에도 반영한다.

## 금지

packaged 앱에 QA 우회 플래그를 추가하지 마라. 이유: 실제 배포 동작의 검증을 약화한다.

운영 SQL·인증서·실제 CLI 추론을 실행하지 마라. 이유: 이 단계는 시작 UX와 설치 검증만 다룬다.
