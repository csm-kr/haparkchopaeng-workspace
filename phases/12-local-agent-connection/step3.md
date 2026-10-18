# Step 3: web-flow

관련 코드: `components/local-agent/**`, `components/shell/topbar.tsx`, `components/shell/app-shell.tsx`, `components/providers/app-providers.tsx`, `components/settings/settings-view.tsx`, `app/(app)/profile/page.tsx`, `tests/e2e/local-agent.spec.ts`.

기존 토큰과 화면 분위기에 맞춰 AI 연결 진입점, 설치/앱 실행/번호 확인/재연결/오프라인/인증 만료/취소를 구현한다. 20px 링은 hover/focus/touch에서만 상세를 보이고 미확인·오래된 값·0%를 구분한다. 모델은 실제 목록에서 사용자가 선택하기 전에는 비워 둔다. profile의 기존 카드에서 팀 논문 질문·답변·취소를 제공하고 논문 상세에 새 탭·사이드패널을 만들지 않는다.

실제 배포 파일이 없으면 다운로드를 가장하지 않는다. 타임아웃으로 미설치를 단정하거나 반복 다운로드하지 않는다. 첫 실행 콜백은 초기 권한 확인 후 한 번 처리한다. 작은 화면에서는 기존 64px 레일로 콘텐츠 폭을 확보한다.

AC: `node scripts/local-agent-verify.mjs e2e`

브라우저는 격리 DB와 headless Chromium을 사용한다. 실제 프로토콜 설치·모델 추론과 mock UI 흐름의 검증 범위를 구분한다.
