# Step 5: team-scoping-e2e

교차 팀 격리·팀 전환·팀별 라이브를 **Playwright E2E**로 검증하고, **운영 DB 마이그레이션 수동 절차**를 문서화한다.

## 읽어야 할 파일

먼저 아래를 읽고 설계 의도를 파악하라. **정본은 루트 `README.md` · `CLAUDE.md` · `PRD.md`.**

항상:
- `docs/dev/ARCHITECTURE.md` · `docs/agent/ADR.md`(**ADR-020**) · `docs/dev/CODING_CONVENTION.md`
- `docs/user/USER_FLOW.md` — 검증할 흐름
- `docs/agent/RULES.md` — R37·R19

이전 step 산출물:
- step 1 스키마+백필(`backfillTeamScoping`), step 2 활성 팀, step 3 스코핑된 읽기, step 4 스코핑된 쓰기+팀별 라이브
- 기존 e2e: `tests/e2e/*.spec.ts`(entry·team·meeting 등) — 공유 운영 DB 비파괴 원칙

## 작업

### 1. Playwright E2E (`tests/e2e/team-scoping.spec.ts`)
**헤드리스·비파괴**로 검증:
- 팀 전환 시 대시보드/라이브러리/발표자료/스케줄이 **활성 팀 데이터**로 바뀐다(한 팀의 항목이 다른 팀 화면에 안 보임).
- 단건 진입(다른 팀 논문 URL 직접 접근) → 404/403.
- 라이브: 활성 팀 기준 빈 상태·시작 게이팅(키 미설정 시 503 친절 안내 — phase 7과 동일).
- **CRITICAL: 공유 운영 DB에 파괴적 데이터를 남기지 마라.** 두 번째 팀이 없으면(MAX_TEAMS=2지만 미생성일 수 있음) 단일 팀 경로로 graceful하게 통과하도록 작성. 실제 2팀 격리 단언은 유닛(step 3·4)이 1차로 커버하고, E2E는 가능한 범위에서.

### 2. 운영 마이그레이션 수동 절차 문서 (`docs/dev/DEPLOY.md`에 절 추가)
다음을 단계로 적는다(실행은 사람이):
```
## 팀 스코핑 마이그레이션 (ADR-020) — 검토 후 수동 실행
1. 백업/스냅샷 확인(Supabase).
2. teamId는 단계적으로:
   a. (코드) schema에 teamId를 우선 nullable로 두는 임시 브랜치로 push  ── 또는 default 후 백필 ──
   b. npx prisma db push   (DIRECT_URL = Supabase 직결)
   c. 백필 실행: backfillTeamScoping() (tsx 스크립트 또는 seed) → 기존 행을 부트스트랩 팀으로
   d. teamId를 non-null로 확정 + 고유 제약(ScheduleMonth/FineConfig/MemberLedger) 적용 push
3. Vercel 재배포.
4. 검증: 두 팀으로 로그인해 데이터 격리 확인.
```
> 제약/PK 변경은 데이터가 있는 테이블에 적용되므로 순서(추가→백필→제약)를 지킨다. 한 번에 non-null+제약을 push하면 기존 행 때문에 실패할 수 있다.

### 3. 정리
- phase 7·이전 e2e가 팀 스코프로 여전히 통과하는지 확인(필요 시 갱신).

## Acceptance Criteria

```bash
npm run build
npm test
npm run lint
npx playwright test
```

## 검증 절차

1. AC 실행.
2. 체크리스트: E2E가 헤드리스·비파괴로 통과? 교차 팀 격리가 유닛+E2E로 커버? 운영 마이그레이션 절차가 DEPLOY.md에 단계적(추가→백필→제약)으로 적혔는가?
3. `phases/8-team-scoping/index.json`의 step 5 업데이트.
4. **summary에 반드시 적는다**: "운영 반영은 DEPLOY.md의 수동 절차(prisma db push + backfillTeamScoping)를 사람이 검토 후 실행해야 함 — 그 전까지 prod 스키마는 teamId 미반영."

## 금지사항

- **E2E가 공유 운영 DB에 파괴적 변경을 남기지 마라.** 이유: 공유·운영 중인 DB(비파괴 원칙).
- **운영 `prisma db push`를 이 step에서 실행하지 마라.** 이유: 검토된 수동 단계(ADR-020). E2E는 코드 레벨 검증만.
- 기존 테스트(phase 7 라이브·entry·team)를 깨뜨리지 마라.
