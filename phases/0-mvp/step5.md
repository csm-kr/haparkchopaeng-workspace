# Step 5: supabase-google-auth

step4의 세션·역할·초대 플럼빙 위에 **Supabase Auth의 Google OAuth 로그인 + 초대 게이트**를 얹는다. Supabase가 신원 제공자(IdP), 우리 서명 세션이 앱 권한 세션이다. UI 로그인 화면은 만들지 않는다(step6 app-shell). 빌드는 라이브 키 없이 통과해야 한다.

## 읽어야 할 파일

먼저 아래 문서를 읽고 설계 의도를 파악하라. **정본은 루트 `README.md` · `CLAUDE.md` · `PRD.md`이며, 충돌 시 이를 따른다.**

항상:
- `docs/dev/ARCHITECTURE.md` — §데이터 흐름·외부 경계
- `docs/agent/ADR.md` — **ADR-007(초대 전용)·ADR-016(Supabase)·ADR-017(Google OAuth+초대 게이트)**. 고치지 말 것.
- `docs/dev/CODING_CONVENTION.md`

이 step(인증/비밀):
- `docs/security/SECURITY.md` — §인증·신뢰 경계. service role 키 서버 전용, 비초대 거부.
- `docs/dev/ENV.md` — §인증(Google OAuth via Supabase). `NEXT_PUBLIC_SUPABASE_URL`·`NEXT_PUBLIC_SUPABASE_ANON_KEY`·`SUPABASE_SERVICE_ROLE_KEY`·`APP_BASE_URL`
- `docs/dev/API.md` — auth 엔드포인트

이전 step 산출물(반드시 재사용):
- `lib/auth.ts` — `createSession(memberId)`·`getSession`·`requireAuth`·`requireRole` (앱 권한 세션). **이걸 신원 검증 뒤에 호출한다.**
- `lib/invite.ts` — 초대 토큰/검증
- `lib/http.ts`(또는 동등) — `ApiOk`/`ApiErr`/`HttpError`
- `app/api/auth/login/route.ts` — step4의 dev 이메일 로그인 (폴백으로 유지)
- `prisma/schema.prisma`·`lib/prisma.ts` — `Member`·`Invite`

## 작업

### 1. Supabase 클라이언트 — `lib/supabase/`
- `@supabase/supabase-js`, `@supabase/ssr` 추가.
- `lib/supabase/server.ts` — `createServerClient`(쿠키 연동, 요청 시점 생성). `NEXT_PUBLIC_SUPABASE_URL`·`NEXT_PUBLIC_SUPABASE_ANON_KEY` 사용.
- `lib/supabase/admin.ts` — `SUPABASE_SERVICE_ROLE_KEY`로 만드는 **서버 전용** 관리 클라이언트(절대 클라이언트 번들 금지).
- (클라이언트용 `browser.ts`는 필요 시. 로그인 시작은 서버 액션/route로 가능.)
- **환경변수는 요청/호출 시점에 읽어** 모듈 로드시 throw하지 않게 한다 → 키 없이도 `next build` 통과.

### 2. Google OAuth 시작 — route 또는 Server Action
- `signInWithOAuth({ provider: 'google', options: { redirectTo: `${APP_BASE_URL}/auth/callback` } })` 로 Google 인증 URL을 받아 리디렉트.

### 3. 콜백 + 초대 게이트 — `app/auth/callback/route.ts`
```
1. supabase.auth.exchangeCodeForSession(code) → Google 이메일 획득
2. 초대 게이트(ADR-017):
   - Member(email) 존재 → 통과
   - 아니면 유효한 Invite(email, status=pending) 존재 → Member 생성 + Invite.status=accepted
   - 둘 다 없음 → supabase signOut + 에러로 리디렉트("초대된 멤버만 로그인할 수 있어요")
3. 통과 시 lib/auth.createSession(member.id) 로 앱 세션 발급 → 홈으로 리디렉트
```
- **CRITICAL: 비초대 이메일은 절대 합류/세션 금지**(R18). Google 인증 성공 ≠ 합류.

### 4. 세션 일원화
- 앱의 권한 판단은 계속 `lib/auth`의 `requireAuth`/`requireRole`(memberId+role)을 쓴다. Supabase 세션은 신원 확인용. 로그아웃은 Supabase signOut + 앱 세션 파기 둘 다.
- step4의 dev 이메일 로그인 route는 **로컬 폴백으로 유지**(키 없을 때 테스트용; 프로덕션 경로 아님).

### 5. 로컬 .env
- 빌드/테스트 통과용 **더미** `NEXT_PUBLIC_SUPABASE_URL`(예: `http://localhost:54321`)·`NEXT_PUBLIC_SUPABASE_ANON_KEY=dummy`·`SUPABASE_SERVICE_ROLE_KEY=dummy`를 로컬 `.env`(gitignore됨)에 추가. **실제 키 아님.** `.env.example` 변경 금지.

## Acceptance Criteria

```bash
npm run build   # 라이브 Supabase 키 없이도 통과(환경변수는 요청 시점에 읽음)
npm test        # vitest run — 초대 게이트 로직(비초대 거부·멤버 통과·초대 수락), 이메일→Member 매핑 (Supabase는 모킹)
npm run lint
```
> 실제 Google OAuth 왕복은 Supabase 프로젝트+Google 클라이언트 키가 있어야 동작한다(런타임). 이 step의 AC는 **빌드·로직 단위 테스트**까지다. 키가 없어 빌드/로직조차 진행 불가하면 `blocked`로 사유를 기록한다.

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 아키텍처 체크리스트:
   - 비초대 이메일이 거부되는가(초대 게이트, ADR-007/017)?
   - `SUPABASE_SERVICE_ROLE_KEY`가 서버에서만 쓰이는가(클라 번들·`NEXT_PUBLIC_` 오용 없음)?
   - 권한 판단이 `lib/auth`로 일원화됐는가(세션에서 memberId/role)?
   - `Member`에 password 컬럼을 추가하지 않았는가?
3. 결과에 따라 `phases/0-mvp/index.json`의 step5를 업데이트:
   - 성공 → `"completed"` + `"summary"`
   - 3회 실패 → `"error"` + `"error_message"`
   - 키/외부설정 필요로 진행 불가 → `"blocked"` + `"blocked_reason"`(필요 키 명시) 후 중단

## 금지사항

- **비초대 이메일에 세션을 발급하거나 Member를 만들지 마라.** 이유: 초대 전용(ADR-007/017). Google 인증 성공만으로 합류 금지.
- **`SUPABASE_SERVICE_ROLE_KEY`를 클라이언트에 노출하지 마라**(`NEXT_PUBLIC_`·번들). 서버 전용(R2).
- **`Member`에 password 컬럼을 추가하거나 마이그레이션하지 마라.** 이유: OAuth가 인증 수단(ADR-017).
- **step4의 lib/auth·invite·http·route를 삭제하지 마라.** 그 위에 얹는다(폴백 유지).
- **모듈 로드 시점에 Supabase 키를 강제로 읽어 throw하지 마라.** 이유: 키 없이 `next build`가 깨진다. 요청/호출 시점에 읽는다.
- **`.env.example` 변경·`.env`에 실제 키 입력 금지.**
- **UI 로그인/팀 화면을 만들지 마라**(step6).
- **`test`를 워치 모드로 두지 마라**(`vitest run`).
- 기존 테스트를 깨뜨리지 마라.
