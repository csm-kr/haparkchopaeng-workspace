# 운영 소스 접합과 검증

사용자가 로컬 개발 완료 후 후속 운영 반영을 요청했다. 최신 운영 기준은 `4c293f15c0e85f32c63fbad3d7f65f6658bb455e`이며, 원래 `hapark` 작업 공간은 읽기 전용으로 보존한다. phase 20·21의 논문 작업과 대화형 PT만 별도 worktree에서 접합한다.

스캔 PDF의 durable OCR, 브릿지 버전·아키텍처 보고, 실제 모델 effort, 연결 설정, 현재 브랜드와 라이브 관련 보정은 최신 main을 유지한다. 기존 개발 검증은 새 배포 소스의 검증으로 대체하지 않는다. 기존 테스트와 새 PT 테스트를 함께 통과시킨다.

## Acceptance Criteria

```text
node scripts/local-agent-verify.mjs all
node --test connector/test/*.test.mjs
node --test scripts/local-agent-verify.test.mjs scripts/local-agent-pg-guard.test.mjs
python -m pytest scripts/test_execute.py -q
node node_modules/next/dist/bin/next lint
node node_modules/next/dist/bin/next build
```

브라우저 검증은 같은 checkout에서 별도 순차 실행한다. SQLite 클라이언트 교체 중 빌드·Prisma 생성을 병렬 실행하지 않는다.

## 운영 반영 순서

1. 정확한 배포 소스·CI·4개 OS/칩 설치 파일을 고정하고 검증한다.
2. 운영 DB의 실제 차이·대상·비공개 백업을 확인한다. 기존 테이블을 지우지 않고 검토 SQL로 두 테이블·한 컬럼과 새 테이블 접근 제한만 트랜잭션 반영한다.
3. 게시 파일을 익명 다운로드해 해시를 대조하고 실제 다운로드 목록을 갱신한다.
4. 웹·Inngest를 반영하고 한 사용자로 논문 읽기부터 PT 출력까지 확인한다. `AGENT_TASKS_ENABLED=1`은 스키마·브릿지·작업 함수가 준비된 뒤 켠다.
5. 소스 SHA·배포 ID·SQL·설치 파일 해시·실제 모델 호출·남은 확인을 기록한다. 운영 완료는 실제 증거가 있을 때만 기록한다.

운영에서 `db push/reset/seed`를 실행하지 않는다. 이유: 검토한 추가 스키마만 반영해야 한다. 원래 작업 공간을 stage/commit하지 않는다. 이유: 다른 작업의 미완료 변경이 함께 있다. 서명·공증·권한 회수는 우회하지 않는다.
