# Step 0: e2e-baseline

이 phase는 **전체 user flow를 헤드리스 e2e로 QA**하는 작업이다. 이 step은 그 토대로,
`npx playwright test`가 **사전에 기동된 서버 없이도** 클린 상태에서 통과하도록 e2e 실행 환경을 고친다.

## 읽어야 할 파일

먼저 아래를 읽고 아키텍처·설계 의도를 파악하라. **정본은 루트 `README.md` · `CLAUDE.md` · `PRD.md`이며, 충돌 시 이를 따른다.**

항상:
- `docs/dev/ARCHITECTURE.md` — 스택·디렉토리 구조
- `docs/agent/ADR.md` — 결정 근거 (의도된 결정이다. 코드를 보고 "고치지" 말 것)
- `docs/dev/CODING_CONVENTION.md` — 코드 규칙

이 step 전용:
- `playwright.config.ts` — 현재 e2e 설정 (수정 대상)
- `app/api/auth/login/route.ts` — dev 로그인 라우트
- `docs/dev/ENV.md` · `docs/dev/DEPLOY.md` — 실행 환경
- `tests/e2e/` 하위 9개 spec 전부 (dashboard·library·meeting·paper·presentation·profile·schedule·team·upload)

## 배경 (반드시 이해하고 작업)

- e2e 로그인은 `POST /api/auth/login { email: "de8167@gmail.com" }` 로 세션 쿠키를 얻는다.
- 그런데 `app/api/auth/login/route.ts`는 `NODE_ENV === "production"`이면 **404**를 반환한다(ADR-017 보안).
- 현재 `playwright.config.ts`의 `webServer.command`는 `npm run build && npm run start ...` → **production 모드**로 띄운다. 따라서 dev 로그인이 404가 되어, **사전 기동된 dev 서버가 없으면 모든 spec이 로그인 단계에서 실패**한다.
- 또한 이 프로젝트는 **로컬 sqlite(dev.db)가 없다.** dev 서버도 `.env`의 **공유 운영 Supabase DB**에 직결한다(`prisma/schema.prisma` provider=postgresql). 따라서 e2e는 **비파괴적·데이터 무관**이어야 한다(이미 9개 spec이 그렇게 작성됨).

## 작업

`playwright.config.ts` 한 곳만 **외과적으로** 수정한다.

1. `webServer.command`를 production 빌드 기동에서 **dev 서버 기동**으로 바꾼다. dev 로그인이 동작해야 하기 때문이다.
   - 권장: `command: \`npm run dev -- --port ${PORT}\``  (= `next dev --port 3100`)
   - `next dev`는 `NODE_ENV !== "production"`이라 `/api/auth/login`이 정상 동작한다.
2. `reuseExistingServer: !process.env.CI`는 **유지**한다(로컬에 이미 dev 서버가 떠 있으면 재사용).
3. `webServer.timeout`은 dev 첫 컴파일이 느릴 수 있으니 최소 `180_000` 이상으로 유지한다.
4. 이제 사실과 어긋난 **주석만** 고친다: "프로덕션 빌드를 띄워..." / "시드 DB(dev.db)를 사용한다" 류 문구를 "dev 서버를 띄워 dev 로그인을 사용하며, DB는 공유 운영 Supabase다(로컬 dev.db 없음)"로 정정한다.

그 외 파일은 **수정하지 않는다.** 9개 spec은 이미 단일 관리자(de8167)·가변 공유 DB 기준으로 작성돼 있으므로 건드리지 않는다.

## Acceptance Criteria

```bash
# 사전에 떠 있는 서버를 모두 끄고(클린 상태), webServer가 dev 서버를 스스로 기동해 통과해야 한다.
npx playwright test
```

기대 결과: **실패 0건** (paper.spec은 `test.skip`이라 1 skipped, 나머지 8 passed). 종료 코드 0.

## 검증 절차

1. 위 AC를 실행한다. (이미 :3100에 dev 서버가 떠 있다면 끄고 클린 상태에서 한 번 더 확인 — 사전 기동 의존을 없애는 게 이 step의 목적이다.)
2. 아키텍처 체크리스트:
   - `playwright.config.ts` 외 다른 파일을 바꾸지 않았는가?
   - dev 로그인 404 문제가 실제로 해소됐는가(클린 상태 통과)?
3. `phases/5-full-qa/index.json`의 step 0을 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary": "playwright webServer를 next dev로 전환해 클린 상태에서 e2e 8 passed·1 skip. 사전 기동 dev 서버 의존 제거."`
   - 3회 시도 후 실패 → `"status": "error"` + `"error_message"`
   - 사용자 개입 필요(예: .env 누락으로 dev 서버 부팅 불가) → `"status": "blocked"` + `"blocked_reason"` 후 즉시 중단

## 금지사항

- `app/api/auth/login/route.ts`의 production 404 가드를 **제거하지 마라.** 이유: 공개 URL에서 시드 이메일만으로 관리자 로그인이 뚫린다(ADR-017 보안 위반). dev 서버로 띄우는 것으로 해결한다.
- 9개 spec 파일의 단언/셀렉터를 **바꾸지 마라.** 이유: 이미 통과하는 데이터-무관 스모크다. 이 step은 실행 환경만 고친다.
- 기존 테스트를 깨뜨리지 마라.
