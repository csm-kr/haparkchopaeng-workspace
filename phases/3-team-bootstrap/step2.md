# Step 2: workspace-api

## 읽어야 할 파일

먼저 아래를 읽고 설계 의도를 파악하라. **정본은 루트 `README.md` · `CLAUDE.md` · `PRD.md`이며, 충돌 시 이를 따른다.**

항상:
- `docs/dev/ARCHITECTURE.md`
- `docs/agent/ADR.md` — **ADR-007/017/018**
- `docs/dev/CODING_CONVENTION.md`

데이터/API/보안:
- `docs/dev/API.md`(인증·멤버 표, 상태코드→UX 매핑) · `docs/dev/SEQUENCE_DIAGRAM.md` · `docs/security/SECURITY.md` · `docs/dev/ENV.md`

기존 코드(패턴·재사용):
- `app/auth/callback/route.ts` — **본 step에서 BOOTSTRAP 분기 추가**. `gateInvitedEmail`/`redirectTo`/`signOut` 흐름.
- `lib/supabase/server.ts` — `createSupabaseServerClient`. 검증 이메일은 `supabase.auth.getUser()`로 취한다.
- `lib/auth.ts` — `createSession`(세션 발급)
- `lib/http.ts` — `ok`/`fail`/`toErrorResponse`
- `lib/workspace.ts`(step 1: `createWorkspaceWithAdmin`) · `lib/invite-gate.ts`(step 1: `GateResult` BOOTSTRAP)
- `app/api/invites/route.ts` · `app/api/auth/logout/route.ts` — route handler 작성 패턴
- `app/api/**/__tests__/`(예: `app/api/live/__tests__/live-routes.test.ts`, `app/api/presentations/__tests__/presentations-create.test.ts`) — 핸들러 테스트 목 패턴
- step 0 문서, step 1 `lib/workspace.ts`

이전 step에서 만들어진 `lib/workspace.ts`를 꼼꼼히 읽고 설계 의도를 이해한 뒤 작업하라.

## 작업

부트스트랩 생성 엔드포인트 + 콜백 라우팅. **TDD: 테스트를 먼저 작성한다.**

`app/api/workspace/route.ts` (신규) `POST`:
- body 검증(zod): `{ name: string }`. 검증 실패 → `fail(400, "BAD_REQUEST", …)`.
- **CRITICAL: 이메일은 Supabase 검증 신원에서 취한다.** `createSupabaseServerClient()` → `supabase.auth.getUser()` → `user.email`이 없으면 `fail(401, "UNAUTHORIZED", …)`. 클라이언트가 보낸 이메일은 신뢰하지 않는다(R3/SECURITY 신뢰 경계).
- `createWorkspaceWithAdmin({ name, email })` 호출 → `createSession(member.id)`로 앱 권한 세션 발급 → `ok({ workspace, member }, 201)`.
- 도메인이 던지는 `409`(이미 존재)/`400`은 `toErrorResponse`가 변환한다(핸들러에서 따로 처리하지 않음).

`app/auth/callback/route.ts` (수정):
- `gateInvitedEmail` 결과가 `!result.ok && result.reason === "BOOTSTRAP"`이면 **`signOut`하지 말고** `redirectTo("/setup")`. 이유: `/setup`이 Supabase 신원으로 팀을 만든다 — 신원 세션을 파기하면 안 된다.
- `result.reason === "NOT_INVITED"`는 **기존 그대로** `signOut` + `redirectTo("/?error=not-invited")`.

## Acceptance Criteria

```bash
npx tsc --noEmit
npx vitest run app/api/workspace
npm run build
npm test
```

TDD 테스트(Supabase `getUser`·prisma·`createSession` 목):
- 검증 이메일 없음 → `401`.
- `name` 빈 값 → `400`.
- 정상 → `201` + `createSession` 호출 + workspace/member 반환.
- 워크스페이스 이미 존재(도메인 409) → `409`.

## 금지사항

- 클라이언트가 보낸 이메일을 사용하지 마라 — 반드시 `supabase.auth.getUser()`의 검증 이메일을 쓴다. 이유: 타인 사칭·권한 상승(R3/SECURITY).
- BOOTSTRAP 분기에서 `signOut`하지 마라. 이유: 신원을 잃으면 `/setup`이 팀을 만들 수 없다.
- `NOT_INVITED` 거부(기존 `signOut` + 리디렉트)를 바꾸지 마라. 이유: 초대 전용 게이트 회귀 금지(ADR-007).
- 기존 테스트를 깨뜨리지 마라.
