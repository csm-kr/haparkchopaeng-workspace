# Step 1 — Durable 작업과 검토한 결과 저장

## 입력

types/agent-task.ts, lib/agent/contract.ts

## 구현·검증

개인 목표/operation 원장, 서버 범위 검사, 제한된 읽기/추론, 편집한 노트·세미나 저장과 별도 재조회를 구현한다. source/revision/grant/중복/경합/세미나 등록을 일회용 DB의 실패 테스트부터 검증한다.

## 산출물

prisma/schema.prisma, lib/agent/service.ts, lib/section-notes.ts, lib/presentation-writes.ts, app/api/agent/, worker/agent-task.ts

## Acceptance Criteria

```powershell
node scripts/local-agent-verify.mjs unit
```

## 금지사항

- 공유 운영 DB에서 db push/seed를 실행하지 마라. 이유: 검증은 일회용 DB에만 허용한다.
- 기존 사용자 변경을 stage/commit하거나 되돌리지 마라. 이유: 이번 작업 이전 변경이 함께 있다.
- 추론 결과나 모델의 저장 주장을 완료 근거로 사용하지 마라. 이유: 도메인 원문/실제 객체를 별도로 확인해야 한다.
- 생성 코드에 실제 키·기기 토큰·스토리지 URL을 넣지 마라. 이유: 권한은 서버에서 관리한다.

검증은 `python scripts/execute.py 20-agent-centric-foundation --verify --step 1`으로 결과를 기록한다.
