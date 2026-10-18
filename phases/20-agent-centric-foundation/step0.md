# Step 0 — 작업 계약과 원문 검증

## 입력

docs/design/AGENT_CENTRIC_APP_PLAN.md, docs/user/PRD.md, docs/agent/ADR.md

## 구현·검증

strict 목표/행동 스키마, note/seminar 결과 구분, 실제 읽은 페이지의 인용 무결성을 TDD로 고정한다.

## 산출물

types/agent-task.ts, lib/agent/contract.ts

## Acceptance Criteria

```powershell
node node_modules/vitest/vitest.mjs run lib/agent/__tests__/contract.test.ts
```

## 금지사항

- 공유 운영 DB에서 db push/seed를 실행하지 마라. 이유: 검증은 일회용 DB에만 허용한다.
- 기존 사용자 변경을 stage/commit하거나 되돌리지 마라. 이유: 이번 작업 이전 변경이 함께 있다.
- 추론 결과나 모델의 저장 주장을 완료 근거로 사용하지 마라. 이유: 도메인 원문/실제 객체를 별도로 확인해야 한다.
- 생성 코드에 실제 키·기기 토큰·스토리지 URL을 넣지 마라. 이유: 권한은 서버에서 관리한다.

검증은 `python scripts/execute.py 20-agent-centric-foundation --verify --step 0`으로 결과를 기록한다.
