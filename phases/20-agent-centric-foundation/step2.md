# Step 2 — 기존 AI 브릿지 실행 계약

## 입력

lib/agent/contract.ts, lib/local-agent/service.ts

## 구현·검증

agent_step_v1 capability와 전용 JSON 행동 지침을 추가한다. 구형 브릿지의 일반 대화/분석을 보존하며 CLI 도구 제한을 확인한다.

## 산출물

connector/core/adapters.mjs, connector/test/agent-context.test.mjs, lib/local-agent/PROTOCOL.md

## Acceptance Criteria

```powershell
node --test connector/test/*.test.mjs
```

## 금지사항

- 공유 운영 DB에서 db push/seed를 실행하지 마라. 이유: 검증은 일회용 DB에만 허용한다.
- 기존 사용자 변경을 stage/commit하거나 되돌리지 마라. 이유: 이번 작업 이전 변경이 함께 있다.
- 추론 결과나 모델의 저장 주장을 완료 근거로 사용하지 마라. 이유: 도메인 원문/실제 객체를 별도로 확인해야 한다.
- 생성 코드에 실제 키·기기 토큰·스토리지 URL을 넣지 마라. 이유: 권한은 서버에서 관리한다.

검증은 `python scripts/execute.py 20-agent-centric-foundation --verify --step 2`으로 결과를 기록한다.
