# 테스트 환경

자동 테스트는 운영 Supabase DB와 분리한다. 로컬 `.env`에 운영 URL이 있어도 아래 실행기는 이를 테스트 DB 주소로 덮어쓴다.

| 명령 | 검증 대상 | DB |
|---|---|---|
| `npm run test` | Vitest·Testing Library 단위 테스트 | DB 호출은 mock, 실제 연결은 차단된 loopback 주소 |
| `npm run test:db` | 시드 검증, 실제 PostgreSQL 라이브 동시성·중복 종료 | 실행마다 새 로컬 PostgreSQL |
| `npm run test:e2e` | 전체 Playwright | 실행마다 새 로컬 PostgreSQL + 별도 Next dev 서버 |
| `npm run test:e2e -- tests/e2e/live-recovery.spec.ts tests/e2e/meeting.spec.ts` | 라이브 회귀와 기본 입장 동선 | 위와 동일 |

`embedded-postgres` 개발 의존성이 현재 OS의 PostgreSQL 실행 파일을 제공한다. Docker나 별도 DB 설치는 필요 없다. 초기 실행은 바이너리 설치와 초기화 시간이 필요하다. Linux에서는 PostgreSQL을 실행할 수 있는 일반 사용자로 실행한다.

실행기는 loopback에만 DB를 열고 무작위 포트·비밀번호·`hapark_test_` 접두사의 새 DB를 사용한다. 그 DB에만 `prisma db push`와 시드를 적용한 뒤 검증하고 서버를 종료한다. 파일은 OS 임시 디렉터리의 `hapark-test-db/run-*`에 남긴다. Windows의 한글 설치 경로 문제를 피하도록 필요한 바이너리를 해당 실행의 임시 디렉터리에 복사한다.

DB 테스트 설정과 Playwright 설정은 `HAPARK_TEST_DB=1`, 로컬 `TEST_DATABASE_URL`, 테스트 DB 이름을 검사한다. 일반 `npx playwright test`나 운영 URL을 사용하는 실행은 중단하고 전용 명령을 안내한다. Supabase·LiveKit·Gemini·Inngest 키는 테스트 자식 프로세스에서 비워 외부 운영 서비스 호출을 막는다. 기존에 떠 있는 3100 포트 서버를 재사용하지 않는다.

라이브 브라우저 회귀는 실제 Next 화면·인증·조회·종료 API와 로컬 DB를 사용한다. 시작·참가 토큰 응답만 외부 SFU 없이 재현하도록 대체한다. 검증 범위는 이전 종료 응답의 지연, 오프라인 중 종료·재시작 후 복구, 두 팀 동시 사용이다. 실제 여러 기기의 카메라·마이크 품질이나 외부 SFU 부하를 측정하는 테스트는 아니다.
