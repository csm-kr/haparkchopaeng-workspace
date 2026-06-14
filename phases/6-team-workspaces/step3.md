# Step 3: entry-flow (로그인 누구나 + 팀 없음 진입 + 초대 복귀)

## 읽어야 할 파일
정본은 루트 `README.md`·`CLAUDE.md`·`PRD.md`. 충돌 시 이를 따른다.
- `docs/agent/ADR.md`(**ADR-018**, ADR-017 개정, ADR-015) · `docs/agent/RULES.md`(R18·R19) · `docs/security/SECURITY.md`(리다이렉트 정제) · `docs/dev/SEQUENCE_DIAGRAM.md`
- `app/auth/callback/route.ts`(기존 `gateInvitedEmail` 사용) · `app/api/auth/google/route.ts`(OAuth 시작) · `app/page.tsx`(로그인 화면 진입)
- `app/(app)/layout.tsx`(인증 가드) · `lib/auth.ts`(`getSession`/`createSession`)
- `lib/invite-gate.ts`(step 2: `findOrCreateMember`, 기존 `gateInvitedEmail`) · `lib/teams.ts`(step 2 기준: `resolveEntryTeam`)
- `components/shell/*`(topbar/app-shell — 팀 전환 위치)

## 작업
"로그인은 누구나, 합류만 토큰"(ADR-018)을 진입 흐름에 연결한다.

1. `app/auth/callback/route.ts` — 게이트 제거:
   - Google 신원(email) 확보 후 **거부하지 않는다.** `findOrCreateMember(email)`로 멤버를 찾거나 만들고 `createSession(member.id)`.
   - `signOut`/`?error=not-invited` 분기 제거. (OAuth 실패·코드 없음 등 기술 오류 처리는 유지.)
   - **초대 복귀**: 콜백 URL의 `next`(또는 동반 쿠키)에 `/invite/{token}` 등 원래 목적지가 있으면 거기로, 없으면 `/dashboard`로 리다이렉트. `next`는 **same-origin `/path`만** 허용하도록 정제(오픈 리다이렉트 차단, SECURITY).
2. `app/api/auth/google/route.ts` — `next`(로그인 후 목적지)를 받아 `redirectTo = {base}/auth/callback?next={정제된 next}`로 전달. 기존 `isGoogleEnabled` 가드는 유지.
3. `lib/invite-gate.ts` — 기존 `gateInvitedEmail`(거부 게이트)을 **제거**(이제 콜백이 `findOrCreateMember` 사용). 제거로 깨지는 참조 없게 정리.
4. 진입 게이팅 — "팀 없음"이면 앱 진입을 막고 안내:
   - `app/(app)/layout.tsx` 또는 그 하위 진입점에서 `resolveEntryTeam(session.memberId)` 확인. `null`이면(=멤버십 없음) `/teams/new`(팀 만들기/초대 안내)로 보낸다. (해당 화면 자체는 step 4가 채움 — 여기선 **라우팅/가드만**.)
   - `/teams/new`로 보내는 무한 루프를 피하라(그 경로·`/invite/*`·인증 경로는 가드 예외).
5. 팀 전환(있으면) — 셸 토판/헤더에 현재 팀 표시 + 멤버십 팀 간 전환 링크(데이터는 RSC props). 멤버십 1개뿐이면 단순 표시. (전체 스타일링은 step 4와 겹쳐도 되지만 최소 동작.)

CRITICAL:
- 비초대 이메일을 **거부하지 마라**(ADR-018: 로그인은 누구나). 합류 게이트는 팀 합류(초대 토큰)에만.
- `next`/`redirectTo`는 항상 정제(same-origin `/path`만). 이유: 오픈 리다이렉트 = 피싱 벡터(SECURITY).
- 세션 발급은 기존 `lib/auth`(자체 서명 쿠키) 유지 — `@supabase/ssr` 세션으로 바꾸지 마라(ADR-016/018 범위 밖).
- `memberId`/`role`은 세션·DB에서(R3).

## Acceptance Criteria
```bash
npm run build   # 타입/컴파일 에러 없음
npm test        # 기존 + (콜백/게이트 관련 유닛 있으면) 통과
npx playwright test   # 핵심 경로: ① 로그인→팀 없음→/teams/new 안내 ② /invite/{token} 미로그인→로그인→초대 화면 복귀. dev 서버 reuse 전제(기존 e2e 관행).
```
> Google OAuth 실제 왕복은 키 필요 — 키 없으면 해당 E2E는 dev 로그인 폴백/`skip`으로 두고, `next` 정제·게이팅 라우팅 같은 **검증 가능한 부분만** 테스트. OAuth 키가 막으면 `blocked` 대신 검증 가능한 범위로 한정해 완료.

## 금지사항
- 기존 기능 페이지(논문·스케줄 등)를 팀별로 쪼개지 마라. 이유: 이번 phase 범위 밖(ADR-018).
- 팀 생성/초대 수락 **화면**을 여기서 완성하지 마라. 이유: step 4 소관(여긴 라우팅·콜백·가드).
- 기존 테스트를 깨뜨리지 마라.
