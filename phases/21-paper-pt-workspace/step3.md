# Step 3 — presentation-export

## 입력

lib/seminar/contract.ts, lib/seminar/workflow.ts, lib/pdf-page-render.ts, lib/storage.ts

## 작업

Generate safe self-contained HTML and Korean PDF from structured diagrams/real source assets, in durable export jobs. Verify exact draft/source ownership before exposing artifacts or attaching them on reviewed registration. Test geometry, escaping, real PDF and authorization.

## Acceptance Criteria

```powershell
node node_modules/vitest/vitest.mjs run lib/seminar/__tests__/render.test.ts
```

## 금지사항

- 운영 DB에 db push/seed를 하지 마라. 이유: 테스트는 일회용 DB만 사용한다.
- CLI의 셸·브라우저·MCP 제한을 풀지 마라. 이유: 모델은 검증되는 구조화 행동만 제안한다.
- 다른 팀 자료나 원문에 없는 수치·그림을 증거로 사용하지 마라. 이유: 원문 근거를 보존해야 한다.
- 사용자 기존 변경을 stage/commit/reset하지 마라. 이유: 현재 워크스페이스에 별도 변경이 있다.

실행 기록은 `python scripts/execute.py 21-paper-pt-workspace --verify --step 3`으로 남긴다.
