# Step 3 — 논문에서 세미나·노트로 이어지는 화면

## 입력

types/agent-task.ts, app/api/agent/, lib/agent/service.ts

## 구현·검증

세미나 만들기 진입점, 논문 선택, 개인 작업 카드, 근거·슬라이드 편집, 명시적 등록, 실제 객체 링크, 새로고침 복원을 연결한다. 대화 전환 중 이전 작업을 한 프레임도 표시하지 않는 회귀를 확인한다.

## 산출물

components/agent/, components/research-chat/, app/(app)/ai-chat/, app/(app)/presentations/, tests/e2e/agent-task.spec.ts

## Acceptance Criteria

```powershell
node scripts/local-agent-verify.mjs e2e
```

## 금지사항

- 공유 운영 DB에서 db push/seed를 실행하지 마라. 이유: 검증은 일회용 DB에만 허용한다.
- 기존 사용자 변경을 stage/commit하거나 되돌리지 마라. 이유: 이번 작업 이전 변경이 함께 있다.
- 추론 결과나 모델의 저장 주장을 완료 근거로 사용하지 마라. 이유: 도메인 원문/실제 객체를 별도로 확인해야 한다.
- 생성 코드에 실제 키·기기 토큰·스토리지 URL을 넣지 마라. 이유: 권한은 서버에서 관리한다.

검증은 `python scripts/execute.py 20-agent-centric-foundation --verify --step 3`으로 결과를 기록한다.
