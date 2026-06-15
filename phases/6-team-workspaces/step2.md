# Step 2: invite-tokens (초대 토큰 모델 + 합류 도메인 + API)

## 읽어야 할 파일
정본은 루트 `README.md`·`CLAUDE.md`·`PRD.md`. 충돌 시 이를 따른다.
- `docs/agent/ADR.md`(**ADR-018**, ADR-016 앱레벨, ADR-015) · `docs/agent/RULES.md`(R18·R19·R3·R32) · `docs/security/SECURITY.md` · `docs/dev/API.md`
- `prisma/schema.prisma`(기존 `Invite` + step 0의 `Team`/`Membership`/`TeamInviteAcceptance`)
- `lib/invite.ts`(기존 **서명 토큰** 방식 — 교체 대상) · `lib/invite-gate.ts`(기존 `gateInvitedEmail`)
- `lib/teams.ts`(step 1: `getMembership`/`isTeamAdmin`/역할 헬퍼) · `lib/auth.ts` · `lib/http.ts` · `lib/sign.ts`
- `app/api/invites/route.ts` · `app/api/invites/[id]/route.ts` · `app/api/invites/[id]/resend/route.ts` · `app/api/invites/accept/route.ts`
- `lib/team.ts`(`PendingInviteView` 매핑) · `components/team/types.ts` · `components/team/team-manager.tsx`
- 기존 테스트: `lib/__tests__/invite.test.ts` · `lib/__tests__/invite-gate.test.ts` · `components/team/__tests__/team.test.tsx`

## 작업
초대를 **이메일 매칭 → 랜덤 토큰 합류**(ADR-018)로 바꾼다. 하나의 수직 슬라이스(초대 토큰 도메인)다 — 스키마·lib·API·소비처를 **함께** 고쳐 step 끝에 build/test가 green이어야 한다.

1. `prisma/schema.prisma` — `Invite` **재설계**(기존 `email`/`status`/`invitedBy` 폐기):
   - `id`(cuid), `teamId`, `token`(`@unique`), `role`(String, 허용값 `admin`|`member` — **owner 금지**, 주석), `maxUses`(Int `@default(1)`), `usedCount`(Int `@default(0)`), `expiresAt`(DateTime), `revokedAt`(DateTime?), `usedAt`(DateTime?), `createdBy`(Member.id), `createdAt`(`@default(now())`). `team` 관계(`onDelete: Cascade`), `@@index([teamId])`.
   - `types/entities.ts`의 `Invite` DTO도 새 구조로 교체.
2. `lib/invite.ts` — **서명 JWT 방식 제거**, 랜덤 토큰 + DB 조회로 전환(서버 전용):
   - `generateInviteToken()` = `crypto.randomBytes(18).toString("base64url")`(추측 불가, ≥16자).
   - `INVITE_TTL` = 7일.
   - `createInvite(input: { teamId; role: "admin"|"member"; maxUses?: number; createdBy: string })` → 토큰 생성·`expiresAt=now+7일`·insert, 생성된 invite 반환.
   - `inviteLink(token)` → `${APP_BASE_URL}/invite/${token}`(서버에서만 base 읽음).
   - `getInviteForAcceptance(token)` → 표시용 프리뷰(토큰 자체는 재반환 금지): `{ teamName, teamSlug, role, expiresAt, revokedAt, usedCount, maxUses, status }`. `status`는 파생: `not_found`|`revoked`|`expired`|`used_up`|`ready`.
   - `acceptInvite(input: { token; memberId })` → 합류(트랜잭션):
     1. `select … for update` 의미로 invite 행을 잠가 **동시 수락 race 직렬화**(Prisma는 `$transaction` 내 `SELECT … FOR UPDATE`를 raw로). 없으면 `not_found`.
     2. 검사 순서: `revoked`(revokedAt) → `expired`(expiresAt<now) → `used_up`(usedCount≥maxUses).
     3. **멱등**: 이미 그 팀 멤버면 **석 소모 없이** 성공 반환(`{ teamSlug, alreadyMember:true }`).
     4. `Membership` 생성(role = invite.role) + `TeamInviteAcceptance` 기록(`onConflict (inviteId,memberId) do nothing`) + `usedCount += 1`, 첫 사용이면 `usedAt=now`.
   - 각 실패는 코드 문자열(`not_found`/`revoked`/`expired`/`used_up`)로 구분 가능하게 반환/throw(`HttpError`)해 UI가 사람말 메시지로 번역(R30).
3. `lib/invite-gate.ts` — `findOrCreateMember(email): Promise<Member>`를 **추가**(기존 `gateInvitedEmail`은 step 3에서 교체하니 **남겨둔다** — build green 유지). 동작: 이메일로 멤버 찾으면 반환, 없으면 생성(이름=local-part, 기본 `Member.role="멤버"`, handle/color/initial은 기존 패턴). **거부(NOT_INVITED) 없음** — 로그인은 누구나(ADR-018).
4. API 교체:
   - `app/api/invites/route.ts` — `POST { teamSlug, role:"admin"|"member", maxUses?:1..100 }`. 권한: **owner·admin만**(`requireAuth` + `isTeamAdmin(team, memberId)`, 아니면 403, R19). `createBy`는 세션에서(R3). 응답 `{ invite, link }`. `GET ?teamSlug=` — 그 팀 활성 초대 목록(admin만).
   - `app/api/invites/[id]/route.ts` — `DELETE` = 회수(`revokedAt=now`), owner·admin만.
   - `app/api/invites/[id]/resend/route.ts` — 토큰 재노출(회수 후 새 invite 발급 또는 기존 링크 반환). **단순화**: 기존 활성 invite면 `{ link }` 반환, 아니면 404.
   - `app/api/invites/accept/route.ts` — **삭제**(이메일·서명 방식 폐기). 수락은 step 4의 `/invite/[token]`에서 Server Action으로.
5. 소비처 **최소 컴파일 수정**(전체 UI는 step 4):
   - `components/team/types.ts` `PendingInviteView` — `email` 제거, `{ id, role, token?, maxUses, usedCount, expiresAt, createdAt }`로.
   - `lib/team.ts` 매핑 갱신(이번 phase에선 기존 단일 워크스페이스 화면이 쓰는 부분만 깨지지 않게 — 초대 목록은 비우거나 새 구조로).
   - `components/team/team-manager.tsx` — 이메일 입력/표시 제거해 **컴파일만** 통과시킨다(완전한 토큰 초대 UI는 step 4). 큰 UI 재작성 금지.
6. 테스트(R23 TDD): `lib/__tests__/invite.test.ts` 재작성(토큰 생성·프리뷰 status 파생·acceptInvite 멱등/만료/회수/used_up, prisma 인메모리 목). `lib/__tests__/invite-gate.test.ts`에 `findOrCreateMember`(있으면 반환/없으면 생성, 거부 없음) 케이스. 기존 깨진 단언 갱신.

CRITICAL:
- `Invite`에 **이메일 컬럼을 두지 마라**. `role`에 `owner`를 허용하지 마라(ADR-018).
- 합류는 `acceptInvite`(앱레벨 트랜잭션)만 `Membership`을 쓴다 — 라우트/클라가 직접 멤버십 insert 금지(멱등·race·감사 보장).
- 토큰은 충분한 엔트로피의 랜덤값(`randomBytes(18).base64url`). 서명 JWT로 회귀하지 마라.
- 권한 체크는 핸들러 진입부에서 멤버십 역할로(R19). UI 게이팅은 보조.
- `gateInvitedEmail`을 이 step에서 지우지 마라(`/auth/callback`이 아직 사용 — step 3에서 교체). 이유: build green 유지.

## Acceptance Criteria
```bash
npm test        # invite/invite-gate/team 테스트 통과 + acceptInvite 멱등·만료·회수·used_up·race(직렬화) 케이스
npm run build   # 타입/컴파일 에러 없음(소비처 컴파일 수정 포함)
```
- `prisma db push`는 step 0과 동일하게 **실행하지 마라**(운영 DB). 필요하면 `blocked` 기록.

## 금지사항
- 초대 합류 UI(`/invite/[token]` 페이지)를 만들지 마라. 이유: step 4 소관. 여기선 도메인 `getInviteForAcceptance`/`acceptInvite`까지.
- `/auth/callback`을 바꾸지 마라. 이유: step 3 소관.
- RLS/트리거/RPC를 만들지 마라(ADR-016).
- 기존 테스트를 깨뜨리지 마라(갱신은 하되 의도된 동작을 약화시키지 마라).
