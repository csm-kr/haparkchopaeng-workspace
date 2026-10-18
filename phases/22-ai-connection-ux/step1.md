# 승인한 현재 기기의 탭 간 복원

입력: `components/local-agent/provider.tsx`, `types/local-agent.ts`, `lib/local-agent/service.ts`의 현재 세션·팀 grant 계약, `components/local-agent/__tests__/device-restoration.test.tsx`.

Aside 운영 화면에서 기존 연결 탭의 현재 기기가 online이고 실제 모델 19개가 준비됐는데 새 `/profile` 탭은 기기 힌트가 없어 모델 선택이 비활성인 상태를 두 번 재현했다. 새 탭의 빈 sessionStorage와 같은 브라우저의 공유 저장소를 구분하는 회귀를 먼저 실패시키고 수정한다. 공유하는 값은 비밀 아닌 team별 device ID 힌트뿐이다. 모든 복원과 storage event는 `status(deviceId)`로 현재 세션의 grant를 다시 검증한 뒤 카탈로그·모델 선택·heartbeat를 허용한다. 다른 온라인 PC 목록을 임의 선택하지 않는다.

AC: `node node_modules/vitest/vitest.mjs run components/local-agent/__tests__/device-restoration.test.tsx`.

번호·launch token·인증 토큰을 localStorage에 넣지 마라. 이유: 탭 공유에는 기기 ID만 필요하다. 원본 dirty checkout을 수정하지 마라. 이유: 사용자 작업과 인덱스를 보존한다. 무효 힌트와 로그아웃·팀 변경·이전 응답으로 권한을 되살리지 마라. 이유: 복원은 서버 권한 검증의 대체가 아니다.

산출물: 연결 복원 코드·회귀 테스트와 RED/GREEN 기록. 앱 패키지와 DB 스키마는 변경하지 않는다.
