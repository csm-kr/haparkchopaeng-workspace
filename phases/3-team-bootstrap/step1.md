# Step 1: workspace-domain

## 읽어야 할 파일

먼저 아래를 읽고 설계 의도를 파악하라. **정본은 루트 `README.md` · `CLAUDE.md` · `PRD.md`이며, 충돌 시 이를 따른다.**

항상:
- `docs/dev/ARCHITECTURE.md`
- `docs/agent/ADR.md` — **ADR-007**(단일 테넌트·초대 전용) · **ADR-017** · **ADR-018**(부트스트랩, step 0에서 추가됨)
- `docs/dev/CODING_CONVENTION.md`

데이터/보안:
- `docs/dev/DB.md` · `docs/dev/API.md` · `docs/security/SECURITY.md` · `docs/dev/ENV.md`

기존 코드(패턴·재사용):
- `lib/invite-gate.ts` — **본 step에서 확장**. `gateInvitedEmail`, Member 생성 패턴(`local`/`handle`/`color`/`initial`), `$transaction` 사용법.
- `lib/http.ts` — `HttpError`(409/400 던질 때 사용)
- `lib/prisma.ts` · `prisma/schema.prisma`(`Workspace`/`Member` 필드) · `prisma/seed.ts`(부트스트랩이 대체하는 워크스페이스/관리자 생성 로직 참고)
- `lib/__tests__/` — 기존 prisma 목 패턴(테스트 작성 시 그대로 따른다)
- step 0에서 갱신된 `docs/**`

이전 step에서 만들어진 문서(ADR-018 등)를 꼼꼼히 읽고 설계 의도를 이해한 뒤 작업하라.

## 작업

부트스트랩 도메인 로직을 lib에 둔다. **TDD: 테스트를 먼저 작성하고 통과시키는 구현을 작성한다(CLAUDE.md).**

`lib/workspace.ts` (신규):
- `getWorkspace(): Promise<Workspace | null>` — `prisma.workspace.findFirst()`.
- `createWorkspaceWithAdmin(input: { name: string; email: string }): Promise<{ workspace: Workspace; member: Member }>`
  - 입력 검증: `name`을 트림해 비면 `HttpError(400, "BAD_REQUEST", "팀 이름을 입력해주세요.")`.
  - **CRITICAL: `prisma.$transaction` 안에서 `workspace.count()`가 0이 아니면 `HttpError(409, "CONFLICT", "이미 팀이 만들어졌어요.")`를 던진다.** 이유: 단일 테넌트(ADR-007/018) — 중복 생성·재부트스트랩 차단.
  - 같은 트랜잭션에서 `Workspace` 생성(name, slug = name에서 URL-safe slug 파생, `seats` 기본값) + 첫 `Member` 생성.
  - **CRITICAL: `Member.role`은 항상 `"관리자"`** (생성자=관리자). 역할을 인자/클라이언트로 받지 않는다(R3, 권한 상승 방지).
  - `id`/`handle`/`color`/`initial`은 `lib/invite-gate.ts`의 멤버 생성 패턴을 그대로 따른다(`email`에서 `local` 파생 등).

`lib/invite-gate.ts` (수정):
- `GateResult` 유니온에 `{ ok: false; reason: "BOOTSTRAP" }` 추가.
- `gateInvitedEmail(email)`: 기존 멤버 매칭이 없을 때, **초대 조회보다 먼저** `getWorkspace()`가 `null`이면 `{ ok: false, reason: "BOOTSTRAP" }`을 반환.
  - **CRITICAL: `getWorkspace()`가 존재(non-null)하면 절대 BOOTSTRAP을 반환하지 않는다.** 이유: 워크스페이스가 있는데 BOOTSTRAP을 열면 초대 전용을 우회하는 공개 가입 구멍이 된다(ADR-007).

## Acceptance Criteria

```bash
npx tsc --noEmit
npx vitest run lib
npm run build
npm test
```

TDD 테스트:
- `getWorkspace()`가 `null`일 때 `gateInvitedEmail`이 `BOOTSTRAP`을 반환.
- 워크스페이스가 존재 + 멤버/초대 없음 → 기존 `NOT_INVITED`(회귀 가드).
- `createWorkspaceWithAdmin`: 워크스페이스 + 관리자 멤버 생성(역할 `"관리자"`), **재호출 시 409**.

## 금지사항

- 워크스페이스가 존재할 때 BOOTSTRAP을 반환하지 마라. 이유: 초대 전용 우회(공개 가입) 구멍이 된다(ADR-007).
- 생성자의 역할을 인자/클라이언트 입력으로 받지 마라 — 항상 `"관리자"`. 이유: 권한 상승 방지(R3).
- 외부 호출이나 service role 키를 쓰지 마라 — Prisma만 사용한다. 이유: lib 도메인 계층(R2/SECURITY).
- 기존 `gateInvitedEmail`의 멤버/초대 통과·`NOT_INVITED` 동작을 바꾸지 마라(회귀 금지).
