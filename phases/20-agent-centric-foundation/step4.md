# Step 4 — HTTP 계약과 전체 회귀

## 입력

scripts/local-agent-verify.mjs, playwright.local-agent.config.ts, tests/e2e/agent-task.spec.ts

## 구현·검증

기존 인증 쿠키/권한 회수 HTTP 검증과 전체 앱 테스트를 격리 데이터소스로 수행한다. 검증기의 URL/프로세스/캐시 복구도 확인한다.

## 산출물

phases/20-agent-centric-foundation/step4-output.json

## Acceptance Criteria

```powershell
node scripts/local-agent-verify.mjs wire
node scripts/local-agent-verify.mjs all
node --test scripts/local-agent-verify.test.mjs
```

## 금지사항

- 공유 운영 DB에서 db push/seed를 실행하지 마라. 이유: 검증은 일회용 DB에만 허용한다.
- 기존 사용자 변경을 stage/commit하거나 되돌리지 마라. 이유: 이번 작업 이전 변경이 함께 있다.
- 추론 결과나 모델의 저장 주장을 완료 근거로 사용하지 마라. 이유: 도메인 원문/실제 객체를 별도로 확인해야 한다.
- 생성 코드에 실제 키·기기 토큰·스토리지 URL을 넣지 마라. 이유: 권한은 서버에서 관리한다.

검증은 `python scripts/execute.py 20-agent-centric-foundation --verify --step 4`으로 결과를 기록한다.
