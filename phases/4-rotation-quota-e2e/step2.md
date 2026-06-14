# Step 2: e2e-refresh (e2e 완전 갱신)

## 읽어야 할 파일
정본은 루트 `README.md`·`CLAUDE.md`·`PRD.md`.
- `docs/user/USER_FLOW.md` · `docs/design/SCREENS.md`(화면별 빈 상태 표) · `docs/design/SCREEN_FLOW.md`
- `prisma/seed.ts`(현재 = 단일 관리자 조성민/de8167) · `tests/e2e/*.spec.ts`(현재)
- step0·step1에서 바뀐 스케줄/업로드 화면

## 작업
단일 관리자(`de8167@gmail.com` = 조성민) 로그인 + **빈 워크스페이스** 기준으로 e2e를 재작성한다. 현재는 옛 목데이터(멤버 4명·논문 4건 등)를 기대해 깨진다.

- 로그인 이메일은 `de8167@gmail.com`(이미 반영됨).
- `"멤버 4명"`·논문/발표 목록 기대 → **빈 상태 검증**("아직 올라온 논문이 없어요" 등, `SCREENS.md` 빈 상태 표) 또는 단일 관리자(조성민) 기준 검증으로 교체.
- 스케줄: 빈 달 → "일정 짜기" 노출, 로테이션 카드에 본인(조성민) 표시 수준.
- 라이브/스트리밍 spec: 렌더·빈 상태 최소만(깊은 송출 검증은 나중 — 별도).

CRITICAL: e2e는 운영 공유 DB(단일 관리자)에 dev 로그인으로 붙는다. 옛 목데이터 기대를 남기지 마라.

## Acceptance Criteria
```bash
npx playwright test   # 헤드리스 — 전부 통과(또는 의도적으로 보류한 라이브 spec은 test.skip로 명시)
```

## 금지사항
- 옛 목데이터(논문 4건·멤버 4명·6월 스케줄)를 기대하는 단언을 남기지 마라. 이유: 시드 초기화로 더 이상 존재하지 않는다.
- 시드를 e2e 안에서 다시 채우지 마라. 이유: 운영 DB를 오염시킨다 — 빈 상태를 그대로 검증한다.
