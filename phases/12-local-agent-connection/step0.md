# Step 0: verification-tools

관련 코드: `scripts/execute.py`, `scripts/test_execute.py`, `scripts/local-agent-verify.mjs`, `scripts/local-agent-verify.test.mjs`.

협업 중 기존 사용자 변경을 포함하는 `git add -A`를 제거한다. step 소유 경로만 커밋하고 이미 stage된 다른 변경을 보존한다. `--verify --step N`은 독립 에이전트가 구현한 결과의 argv AC만 실행하고 index/output 근거를 기록한다. 브랜치·커밋·중첩 CLI 실행은 하지 않는다. Windows 자식 도구의 창을 숨기고 Codex shared daemon을 실행하지 않는다.

검증기는 root에 설치된 Prisma만 사용한다. 임시 SQLite URL을 명시 주입하고, 공유 운영 URL을 상속해서 db push/seed 하지 못하게 선행 검사한다. schema/client는 무시되는 package cache에 생성해 자동 설치를 막는다. 앱 E2E 동안만 기본 generated client를 SQLite로 교체하고 반드시 Postgres client로 복구한다.

AC:
`python -m pytest scripts/test_execute.py -q`
`node --test scripts/local-agent-verify.test.mjs`

공유 DB에서 seed를 실행하지 마라. 기존 사용자 파일을 전체 stage/commit하지 마라.
