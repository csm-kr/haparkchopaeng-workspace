# Step 1: quota-display (주간 분석 한도 표시)

## 읽어야 할 파일
정본은 루트 `README.md`·`CLAUDE.md`·`PRD.md`.
- `docs/dev/ARCHITECTURE.md` · `docs/agent/ADR.md` · `docs/dev/CODING_CONVENTION.md`
- `docs/dev/API.md` · `docs/dev/ENV.md`(`PAPER_WEEKLY_LIMIT`) · `docs/security/SECURITY.md`
- `lib/rate-limit.ts`(`paperWeeklyLimit`, `isPaperQuotaExceeded`) · `app/api/papers/route.ts`(한도 적용 지점)
- 업로드 모달 컴포넌트(`components/**/upload*` 또는 `*UploadModal*` — 찾아서) · 그 모달을 띄우는 호출부

## 작업
인당 **주간 분석 사용량**을 조회해 **업로드 모달**에 "이번 주 분석 **N/20**"으로 표시한다.

1. `lib/rate-limit.ts`에 `quotaStatus(memberId) → { limit, used, remaining }` 추가. `limit ≤ 0`(무제한)이면 `remaining: null`(무제한 표시용), `used`는 항상 집계. `isPaperQuotaExceeded`와 같은 롤링 7일·`Paper.uploadedAt` 기준 재사용(중복 로직 만들지 말 것).
2. 서버 조회 경로: 업로드 모달이 값을 받도록 한다(RSC props 하향 또는 `GET /api/me` 확장 또는 신규 GET). 세션의 `memberId`로 조회 — 클라가 보낸 id 신뢰 금지(R3).
3. 업로드 모달 UI: "이번 주 분석 N/20"(무제한이면 "이번 주 분석 N" 또는 미표시). `remaining === 0`이면 안내 문구("이번 주 한도를 다 썼어요") + 업로드 비활성 또는 경고.

CRITICAL:
- 한도값(`limit`)은 `paperWeeklyLimit()`(env)에서 취한다. **클라이언트에 20을 하드코딩하지 마라**(R2).
- `reanalyze`는 사용량에 세지 않는다(새 Paper 안 만듦).

## Acceptance Criteria
```bash
npm test        # quotaStatus 단위 테스트(used/remaining/무제한)
npm run build
```

## 금지사항
- 한도/사용량을 클라이언트에서 계산하지 마라. 이유: 신뢰 경계 — 서버가 집계(R3).
- 한도값을 코드에 박지 마라. 이유: env로 조정 가능해야 한다(R2).
