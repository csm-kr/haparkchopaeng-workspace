# Step 4: auth-invite

초대 전용 인증의 **서버 플럼빙**을 만든다: 세션(서명 쿠키)·역할 가드·초대 토큰 발급/검증, 그리고 관련 route handler. UI 로그인 화면은 만들지 않는다(step5). 공개 회원가입은 없다.

## 읽어야 할 파일

먼저 아래 문서를 읽고 설계 의도를 파악하라. **정본은 루트 `README.md` · `CLAUDE.md` · `PRD.md`이며, 충돌 시 이를 따른다.**

항상:
- `docs/dev/ARCHITECTURE.md` — §데이터 흐름(쓰기=route handler/Server Action), §외부 경계
- `docs/agent/ADR.md` — ADR-007(초대 전용)·ADR-015(쓰기 경계). **고치지 말 것.**
- `docs/dev/CODING_CONVENTION.md` — §API 핸들러 규칙(zod·권한 체크 진입부·세션에서 ID)

이 step(인증/권한/비밀):
- `docs/security/SECURITY.md` — §인증·§인가(역할 표)·§신뢰 경계. **권한 체크는 서버 진입부, 작성자/소유자 ID는 세션에서.**
- `docs/dev/API.md` — 인증·멤버·팀·초대 엔드포인트와 권한(🔒/👑) 정의
- `docs/dev/ENV.md` — `AUTH_SECRET`·`INVITE_TOKEN_SECRET`·`APP_BASE_URL`
- `docs/agent/RULES.md` — R2(비밀 서버 전용)·R3(세션에서 ID)·R18(초대 전용)·R19(서버 권한 체크)

이전 step 산출물:
- `lib/prisma.ts` — Member/Invite 조회·생성
- `types/` — `Role`('관리자'|'멤버'|'게스트')·`InviteStatus`·`Member`/`Invite` DTO
- `prisma/schema.prisma` — `Member`·`Invite`(seed에 멤버4·초대2 존재)

## 작업

> **인증 수단 주의:** DB.md의 `Member`에는 비밀번호/OAuth 필드가 없다. 프로덕션 인증 수단(매직링크/OAuth 등)은 **미결**이다. 이 step에서 비밀번호 컬럼을 임의로 추가하지 마라. 대신 세션·역할·초대 플럼빙을 만들고, 로그인은 **시드된 멤버를 이메일로 식별하는 개발용 로그인**으로 둔다(프로덕션 인증 수단은 코드 주석 TODO + 추후 ISSUES 승격).

### 1. 세션 — `lib/auth.ts` (서버 전용)
- `AUTH_SECRET`으로 서명/검증하는 세션. **HTTP-only·Secure·SameSite 쿠키.** 시그니처:
  - `createSession(memberId): Promise<void>` — 서명 쿠키 설정
  - `getSession(): Promise<{ memberId, role } | null>` — 쿠키 검증
  - `requireAuth(): Promise<Session>` — 없으면 401 던지기/처리
  - `requireRole(...roles: Role[]): Promise<Session>` — 부족하면 403
- **세션은 서버에서만 읽는다.** 클라이언트가 보낸 식별자를 신뢰하지 않는다(R3).

### 2. 초대 토큰 — `lib/invite.ts` (서버 전용)
- `INVITE_TOKEN_SECRET`으로 서명/검증. 만료·1회성 권장.
  - `signInvite({ email, role, inviteId }): string`
  - `verifyInvite(token): { email, role, inviteId } | null`

### 3. Route handlers (API.md 대응)
서버 진입부에서 zod 검증 + 권한 체크. 응답은 `ApiOk`/`ApiErr`.
- `POST /api/auth/login` — (개발) 이메일로 시드 멤버 식별 → `createSession`. **공개 가입 경로를 만들지 마라.**
- `POST /api/auth/logout` — 세션 종료
- `GET /api/me` / `PATCH /api/me` — 현재 멤버 조회/프로필 수정(본인)
- `GET /api/members` — 멤버 목록(🔒)
- 초대(👑 관리자): `POST /api/invites`(생성+토큰 링크), `GET /api/invites`(대기 목록), `POST /api/invites/:id/resend`, `DELETE /api/invites/:id`
- `POST /api/invites/accept` — 토큰 검증 → `Member` 생성 + `Invite.status=accepted` + 세션 발급. **토큰 없이는 합류 불가.**

### 4. 로컬 .env
- 빌드/테스트가 통과하도록 로컬 `.env`(gitignore됨)에 **개발용** `AUTH_SECRET`·`INVITE_TOKEN_SECRET`(임의 랜덤)·`APP_BASE_URL=http://localhost:3000`을 추가한다. **실제 운영 키가 아니다.** `.env.example`은 변경하지 마라.

## Acceptance Criteria

```bash
npm run build   # 타입/컴파일 에러 없음
npm test        # vitest run — 세션 sign/verify 왕복, requireRole 403, 초대 토큰 verify(만료·위조 거부)
npm run lint
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 아키텍처 체크리스트:
   - `docs/security/SECURITY.md` 인가 표(👑 관리자 전용)가 핸들러 진입부에서 강제되는가?
   - 작성자/소유자 ID를 세션에서 취하는가(클라 입력 미신뢰)?
   - 비밀이 서버에서만 쓰이는가(`NEXT_PUBLIC_*` 오용 없음)?
   - **공개 회원가입 경로가 없는가**(합류는 초대 토큰 검증으로만 — ADR-007)?
3. 결과에 따라 `phases/0-mvp/index.json`의 step4를 업데이트:
   - 성공 → `"completed"` + `"summary"`
   - 3회 실패 → `"error"` + `"error_message"`
   - 사용자 개입 필요 → `"blocked"` + `"blocked_reason"` 후 중단

## 금지사항

- **공개 회원가입/로그인 경로를 만들지 마라.** 이유: 초대 전용(ADR-007/R18). 합류는 초대 토큰으로만.
- **`Member`에 비밀번호 컬럼을 추가하거나 마이그레이션하지 마라.** 이유: 인증 수단 미결 — 임의 결정 금지. 개발용 이메일 로그인으로 진행하고 프로덕션 수단은 TODO.
- **비밀을 클라이언트에 노출하지 마라**(`NEXT_PUBLIC_`·번들). 세션/초대 검증은 서버에서만(R2).
- **클라이언트가 보낸 `authorId`/`role`을 신뢰하지 마라.** 세션에서 취한다(R3).
- **UI 로그인/팀 화면을 만들지 마라.** 이유: 화면은 step5+. 이 step은 서버 플럼빙.
- **`.env.example`을 변경하지 마라. `.env`에 실제 키를 넣지 마라.**
- **`test`를 워치 모드로 두지 마라**(`vitest run`).
- 기존 테스트를 깨뜨리지 마라.
