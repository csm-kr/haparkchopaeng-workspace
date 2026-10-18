# Step 5 — 정본 대조·SQL·빌드 점검

## 입력

docs/user/PRD.md, docs/agent/ADR.md, docs/agent/RULES.md, steps 0–4 outputs

## 구현·검증

팀/개인 격리, 서버 경계, durable 실행, 원문·검토·멱등성·후조건을 hapark-review로 점검한다. SQL은 오프라인 스키마 차이로 생성하고 운영 적용과 일회용 검증을 구분한다.

## 산출물

docs/dev/sql/20261018-agent-centric-foundation.sql, phases/20-agent-centric-foundation/REVIEW.md

## Acceptance Criteria

```powershell
node node_modules/next/dist/bin/next lint
node node_modules/next/dist/bin/next build
```

## 금지사항

- 공유 운영 DB에서 db push/seed를 실행하지 마라. 이유: 검증은 일회용 DB에만 허용한다.
- 기존 사용자 변경을 stage/commit하거나 되돌리지 마라. 이유: 이번 작업 이전 변경이 함께 있다.
- 추론 결과나 모델의 저장 주장을 완료 근거로 사용하지 마라. 이유: 도메인 원문/실제 객체를 별도로 확인해야 한다.
- 생성 코드에 실제 키·기기 토큰·스토리지 URL을 넣지 마라. 이유: 권한은 서버에서 관리한다.

검증은 `python scripts/execute.py 20-agent-centric-foundation --verify --step 5`으로 결과를 기록한다.
