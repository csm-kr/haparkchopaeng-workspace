# Step 0: team-data-model (멀티팀 데이터 모델 + 이관 시드)

## 읽어야 할 파일
정본은 루트 `README.md`·`CLAUDE.md`·`PRD.md`. 충돌 시 이를 따른다.
- `docs/agent/ADR.md` — **특히 ADR-018(멀티팀 워크스페이스)**, ADR-016(RLS 미사용·앱레벨 권한)
- `docs/agent/RULES.md`(R18) · `docs/dev/CODING_CONVENTION.md` · `docs/dev/DB.md`
- `prisma/schema.prisma` — 기존 `Workspace`·`Member`·`Invite` 모델
- `prisma/seed.ts` · `prisma/__tests__/seed.test.ts`
- `types/entities.ts`(기존 `Member`·`Invite` DTO) · `types/enums.ts`

기존 코드를 읽고 컨벤션(주석 톤·네이밍)을 따른 뒤 작업하라.

## 작업
멀티팀(ADR-018)의 데이터 모델을 **추가만** 한다. 이 step은 **순수 additive** — 기존 `Invite`/`Workspace`/`Member` 및 기존 엔티티는 건드리지 않아 `npm run build`가 깨지지 않는다.

1. `prisma/schema.prisma`에 모델 추가(Postgres, 단 SQLite 호환 타입만 — enum 대신 String + 허용값 주석, ADR-010/016):
   - `Team`: `id`(cuid), `slug`(`@unique`, 앱 검증 `^[a-z][a-z0-9-]{1,23}$`), `name`(앱 검증 2–30자), `createdBy`(Member.id), `createdAt`(`@default(now())`).
   - `Membership`: 복합 PK `@@id([teamId, memberId])`, `teamId`, `memberId`(Member.id), `role`(String, 허용값 `owner`|`admin`|`member` — 주석 명시), `joinedAt`(`@default(now())`). `@@index([memberId])`. `team` 관계(`onDelete: Cascade`).
   - `TeamInviteAcceptance`(합류 감사): `id`(cuid), `inviteId`, `teamId`, `memberId`, `acceptedRole`(String), `acceptedAt`(`@default(now())`), `@@unique([inviteId, memberId])`.
   - `Team`에 역관계: `memberships Membership[]`.
2. `types/enums.ts`에 추가: `export type TeamRole = "owner" | "admin" | "member";`
3. `types/entities.ts`에 DTO 추가(DateTime은 ISO 문자열 — 기존 패턴): `Team`, `Membership`, `TeamInviteAcceptance`. **기존 `Invite` DTO는 건드리지 마라**(step 2에서 재설계).
4. **이관 시드** — `prisma/seed.ts`에 멱등 로직 추가: 기존 "하박조팽" `Workspace`/멤버를 `Team` 1개 + `Membership`으로 이관.
   - 팀이 **하나도 없을 때만** 생성한다(전역 팀 상한 2 위배 방지 + 멱등).
   - `slug = "habakjopaeng"`, `name = "하박조팽"`(Workspace.name 있으면 그 값), `createdBy` = owner가 될 멤버 id.
   - `owner` = 기존 `Member.role === "관리자"` 멤버(여럿이면 `createdAt` 최소). 나머지 전원은 `member`로 `Membership` 생성.
   - 관리자가 없으면(이론상) 첫 멤버를 owner로.

CRITICAL:
- 기존 `Invite`·`Workspace`·`Member` 모델과 기존 엔티티(`Paper`/`Schedule`/`Presentation`/`LiveSession`/`Fine`)를 **수정·삭제하지 마라.** 이유: 이번 step은 additive, Invite 재설계는 step 2, 팀 스코핑은 별도 단계(ADR-018 범위).
- 기존 엔티티에 `teamId`를 붙이지 마라. 이유: 팀 스코핑은 다음 단계.
- RLS 정책·DB 트리거·`security definer` 함수를 만들지 마라. 이유: 앱레벨 권한 일원화(ADR-016).
- `Membership.role`/`Invite.role`은 String + 허용값 주석으로 둔다(Prisma enum 금지 — SQLite 호환, ADR-010/016).

## Acceptance Criteria
```bash
npx prisma generate          # 스키마 → 클라이언트 타입 생성(로컬, DB 접속 없음)
npm run build                # 타입/컴파일 에러 없음
npm test                     # 기존 테스트 전부 통과 + seed.test.ts에 이관 케이스(팀/owner 생성) 추가·통과
```
- **`prisma db push`(운영 Supabase 반영)를 이 step에서 실행하지 마라.** 운영 크리덴셜(`DATABASE_URL`/`DIRECT_URL`)이 필요하면 `index.json`의 이 step을 `"status":"blocked"`, `"blocked_reason":"prisma db push는 운영 DB 스키마 반영이라 사용자 승인·크리덴셜 필요 — 코드/타입/시드는 완료"`로 기록하고 즉시 중단. 코드·타입·시드·테스트만 이 step의 범위다.

## 금지사항
- `Workspace`를 삭제하지 마라. 이유: 기존 기능이 참조할 수 있고, 이관 원본이다.
- 기존 테스트를 깨뜨리지 마라.
