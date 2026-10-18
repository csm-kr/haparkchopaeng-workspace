# 앱 응답 뒤에 확인 번호와 남은 시간을 표시

기존 `components/local-agent/provider.tsx`, `connection-modal.tsx`, `lib/local-agent/service.ts`의 상태와 만료 계약을 사용한다. 초기 웹/미설치 상태에서 숫자를 먼저 보여 주던 흐름을 개선한다.

- `awaiting_app`에는 설치·실행 안내만 보여 준다. 응답 지연으로 미설치를 단정하지 않는다.
- 최초 앱 ACK가 `awaiting_code`로 전이할 때 세션 만료 이내에서 확인 시간을 5분 부여한다. 재ACK로 시간을 연장하거나 오답 횟수를 초기화하지 않는다.
- 웹의 번호는 `awaiting_code`에서만 표시한다. `05:00` 형식의 남은 시간과 줄어드는 진행 막대를 기존 디자인 토큰으로 보여 준다.
- 백그라운드 복귀와 폴링 장애에도 서버의 `expiresAt`으로 재계산한다. 만료되면 번호를 숨기고 새 번호로 연결하게 하며 이전 비동기 응답을 무시한다.
- URI에 번호를 넣거나 자동 입력하지 않는다. 이유: 두 화면을 사용자가 확인하는 절차를 유지해야 한다.
- 설치 파일과 DTO 형태·운영 DB 스키마는 변경하지 않는다. 이유: 기존 0.1.1 설치 앱이 같은 ACK 응답의 만료 시각을 사용할 수 있다.

## Acceptance Criteria

```text
node scripts/local-agent-verify.mjs unit
node scripts/local-agent-verify.mjs e2e
node node_modules/next/dist/bin/next lint
```

격리 SQLite와 테스트 브라우저의 회귀를 실행하고 정본 PostgreSQL client를 복원한다. build와 전체 회귀는 PR의 web CI에서 확인하고, 병합 후 운영 UI는 Aside로 검증한다. 실제 모델 추론은 이 변경 검증에 필요하지 않다.
