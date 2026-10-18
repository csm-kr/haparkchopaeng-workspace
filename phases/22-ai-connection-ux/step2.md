# 정렬된 AI 연결과 현재 모델·작은 사용량 링

입력: `docs/design/DESIGN_GUIDE.md`, `components/local-agent/connection-settings.tsx`, `quota-badge.tsx`, `chat-selection.ts`의 표시 상수, step1의 공유 연결 상태.

왼쪽 AI 연결을 메뉴의 아이콘 슬롯·본문 정렬에 맞추고 현재 실행 대상의 실제 카탈로그 모델명과 작은 사용량 링을 보여 준다. 공급자 탭을 구경하는 동작은 현재 실행 모델·링을 바꾸지 않는다. hover/focus/touch 상세는 실제 구독 비율·초기화·관측 시각을 보여 주며 미확인·오래된 관측·0%를 구분한다. effort는 광고된 값만 `low`, `medium`, `high`, `xhigh`, `max` 원문으로 표시한다. 키보드 포커스와 모바일 범위를 검증한다.

TDD/AC: `node node_modules/vitest/vitest.mjs run components/local-agent/__tests__/connection-controls.test.tsx components/local-agent/__tests__/connection-settings.test.tsx components/local-agent/__tests__/connection-widgets.test.tsx`.

버튼을 중첩하지 마라. 이유: 모델 연결 진입과 링 상세의 독립 키보드·터치 동작이 필요하다. 임의 비율·토큰 잔량을 만들지 마라. 이유: CLI 관측이 제공한 구독 비율만 사실이다. 색·반경·그림자를 하드코딩하지 마라. 이유: 기존 라이트·다크 토큰을 유지한다.
