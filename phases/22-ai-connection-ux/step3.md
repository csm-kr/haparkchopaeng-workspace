# 회귀·브라우저·운영 검증

입력: step1·step2의 코드와 회귀, `scripts/local-agent-verify.mjs`, `tests/e2e/local-agent.spec.ts`, 기존 운영 manifest 0.1.6.

기존 격리 DB 검증기로 전체 단위 테스트·wire·Chromium 플로우를 통과시키고 lint·production build를 완료한다. 실제 브라우저의 새 탭 sessionStorage 분리·공유 device hint·storage event, 모델 활성화와 직접 선택, effort 원문, 링 hover 상세·좁은 화면을 검증한다. 운영 반영은 검토한 커밋만 PR로 올려 정확한 CI를 확인하고 main에 병합한다. Aside에서 운영 화면의 재현 함수를 다시 실행해 GREEN을 기록한다.

AC: `npm run test:isolated`, `npm run lint`, `npm run build` 및 관련 `npm run test:local-agent:e2e`. DB 변환과 Prisma generate는 검증기 하나에서 순서대로 수행한다. 운영 DB·앱 패키지·설치 파일 버전을 변경하지 마라. 이유: 이번 변경은 웹의 상태 복원과 표시다. 실제 추론을 불필요하게 실행하지 마라. 이유: 모델 선택·사용량 UI는 구독을 사용하지 않고 검증할 수 있다.

산출물: 로컬 검증·독립 리뷰·정확한 CI·운영 배포·Aside GREEN 영수증과 남은 한계. 운영·CI 완료 전 상태를 완료로 기록하지 않는다.
