# 관리자 콘솔(`/admin`) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 운영자가 `/admin`에서 이번 달 LiveKit 라이브 사용량(참가자-분 추정)을 보고, 전역 팀 상한을 재배포 없이 조절한다.

**Architecture:** 전역 팀 상한을 env에서 DB(`AppSetting` 단일 row)로 이관하고(ADR-021 개정), env는 폴백으로 남긴다. 라이브 사용량은 `LiveSession`/`Participant`에서 참가자-분을 추정 집계한다. 콘솔 접근은 `Member.email == ADMIN_EMAIL` 일치로만 열리고 실패 시 404로 은닉한다.

**Tech Stack:** Next.js 15 App Router(RSC + Server Action), Prisma/PostgreSQL, TypeScript strict, Tailwind, Vitest + Testing Library

**설계 문서:** `docs/superpowers/specs/2026-08-01-admin-console-design.md`

## Global Constraints

- **모든 주석·문구는 한국어.** 코드·식별자·명령어는 원문 유지.
- **TDD.** 테스트를 먼저 쓰고 실패를 확인한 뒤 구현한다 (R23).
- **R2.** env는 모듈 로드 시점이 아니라 **호출 시점**에 읽는다.
- **R3.** 작성자/식별자는 세션에서 취한다. 클라이언트 입력 미신뢰.
- **R19.** 권한은 진입부에서 강제한다. RSC와 Server Action은 **각각 독립 진입점**이므로 양쪽 모두 검사한다.
- **R30.** 실패는 토스트가 아니라 **인라인 메시지**로 표시한다.
- **ADR-015.** 읽기는 RSC에서 Prisma 직접 조회, 쓰기는 Server Action.
- **우선순위 규칙:** 전역 팀 상한 = `AppSetting.maxTeams` > env `MAX_TEAMS` > 코드 기본 `2`.
- **관리자 이메일 기본값:** `de8167@gmail.com` (env `ADMIN_EMAIL`로 덮어쓰기 가능).
- **라이브 한도 기본값:** `1000`분 (env `LIVE_MINUTES_QUOTA`로 덮어쓰기 가능).
- **Conventional Commits** (`feat:`/`fix:`/`docs:`/`test:`/`refactor:`) (R24).
- **Windows 주의:** `prisma generate` 시 `next dev`가 엔진 DLL을 점유하면 EPERM이 난다 — 개발 서버를 먼저 종료할 것.

## File Structure

| 파일 | 책임 |
|---|---|
| `prisma/schema.prisma` (수정) | `AppSetting` 단일 row 모델 추가 |
| `lib/settings.ts` (신규) | 전역 앱 설정 읽기/쓰기. `maxTeams()`, `setMaxTeams()`, 범위 상수 |
| `lib/live-usage.ts` (신규) | KST 월 경계, 참가자-분 추정 집계, 월별 추이 |
| `lib/auth.ts` (수정) | `requireSuperAdmin()` 추가 |
| `lib/teams.ts` (수정) | `maxTeams()` 제거 → `lib/settings.ts`에서 import, `await` 적용 |
| `app/admin/page.tsx` (신규) | RSC. 권한 게이트 + 데이터 조회 + 레이아웃 |
| `app/admin/usage-panel.tsx` (신규) | 사용량 표시 전용 서버 컴포넌트(진행바·추이·팀별) |
| `app/admin/max-teams-form.tsx` (신규) | 상한 조절 클라이언트 폼(인라인 결과) |
| `app/admin/actions.ts` (신규) | `setMaxTeamsAction` Server Action |
| `docs/agent/ADR.md` (수정) | ADR-021 개정 + ADR-022 신규 |
| `docs/agent/RULES.md` (수정) | R18의 `MAX_TEAMS` 서술 갱신 |
| `docs/dev/ENV.md` (수정) | `MAX_TEAMS`·`ADMIN_EMAIL`·`LIVE_MINUTES_QUOTA` 문서화 |

화면을 `page.tsx` 하나에 몰지 않고 `usage-panel`(읽기 전용 서버 컴포넌트)과 `max-teams-form`(상호작용 클라이언트 컴포넌트)으로 나눈다 — 서버/클라이언트 경계가 곧 책임 경계다.

---

### Task 1: `AppSetting` 모델 + `lib/settings.ts`

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `lib/settings.ts`
- Test: `lib/__tests__/settings.test.ts`

**Interfaces:**
- Consumes: `@/lib/prisma`
- Produces:
  - `maxTeams(): Promise<number>`
  - `setMaxTeams(value: number, updatedBy: string): Promise<void>`
  - `MAX_TEAMS_MIN = 1`, `MAX_TEAMS_MAX = 100` (상수)

- [ ] **Step 1: `AppSetting` 모델을 스키마에 추가**

`prisma/schema.prisma`의 `model Workspace { ... }` 블록 **바로 아래**에 추가한다.

```prisma
// 전역 앱 설정 (ADR-022). 관리자 콘솔(/admin)이 조절한다.
// CRITICAL: row는 단 하나(id="singleton") — Workspace(ADR-007 레거시)와 섞지 않는다.
// CRITICAL: row 부재 = 미설정 → env/코드 기본으로 폴백한다(ADR-006/R15 정신). 자동 생성 금지.
model AppSetting {
  id        String   @id @default("singleton")
  maxTeams  Int? // null = env(MAX_TEAMS)/기본 2로 폴백
  updatedAt DateTime @updatedAt
  updatedBy String? // Member.id (감사용)
}
```

- [ ] **Step 2: 마이그레이션 생성**

개발 서버(`next dev`)가 떠 있으면 먼저 종료한다(Windows EPERM 회피).

Run: `npx prisma migrate dev --name add_app_setting`
Expected: `prisma/migrations/<타임스탬프>_add_app_setting/` 생성 + Prisma Client 재생성 성공

- [ ] **Step 3: 실패하는 테스트 작성**

Create `lib/__tests__/settings.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// 전역 앱 설정(ADR-022)의 우선순위 규칙을 prisma 인메모리 목으로 검증한다.
// CRITICAL: 우선순위는 DB > env > 코드 기본 2. row 부재는 "미설정"이지 0이 아니다.

interface SettingRow {
  id: string;
  maxTeams: number | null;
  updatedBy: string | null;
}

const { db } = vi.hoisted(() => ({
  db: { setting: null as SettingRow | null },
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    appSetting: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) =>
        db.setting && db.setting.id === where.id ? db.setting : null,
      ),
      upsert: vi.fn(
        async ({
          where,
          create,
          update,
        }: {
          where: { id: string };
          create: { id: string; maxTeams: number; updatedBy: string };
          update: { maxTeams: number; updatedBy: string };
        }) => {
          if (db.setting && db.setting.id === where.id) {
            db.setting = { ...db.setting, ...update };
          } else {
            db.setting = { id: create.id, maxTeams: create.maxTeams, updatedBy: create.updatedBy };
          }
          return db.setting;
        },
      ),
    },
  },
}));

const { MAX_TEAMS_MAX, MAX_TEAMS_MIN, maxTeams, setMaxTeams } = await import("@/lib/settings");

const ORIGINAL_MAX = process.env.MAX_TEAMS;

beforeEach(() => {
  db.setting = null;
  delete process.env.MAX_TEAMS;
});

afterEach(() => {
  if (ORIGINAL_MAX === undefined) delete process.env.MAX_TEAMS;
  else process.env.MAX_TEAMS = ORIGINAL_MAX;
});

describe("maxTeams()", () => {
  it("DB row도 env도 없으면 기본 2", async () => {
    expect(await maxTeams()).toBe(2);
  });

  it("DB row가 없고 env가 있으면 env 값", async () => {
    process.env.MAX_TEAMS = "5";
    expect(await maxTeams()).toBe(5);
  });

  it("DB row가 있으면 env를 무시하고 DB 값", async () => {
    process.env.MAX_TEAMS = "5";
    db.setting = { id: "singleton", maxTeams: 7, updatedBy: "ha" };
    expect(await maxTeams()).toBe(7);
  });

  it("DB row는 있지만 maxTeams가 null이면 env로 폴백", async () => {
    process.env.MAX_TEAMS = "4";
    db.setting = { id: "singleton", maxTeams: null, updatedBy: "ha" };
    expect(await maxTeams()).toBe(4);
  });

  it("env가 잘못된 값이면 기본 2로 폴백", async () => {
    process.env.MAX_TEAMS = "abc";
    expect(await maxTeams()).toBe(2);
  });

  it("호출 시점에 env를 읽는다(R2)", async () => {
    process.env.MAX_TEAMS = "3";
    expect(await maxTeams()).toBe(3);
    process.env.MAX_TEAMS = "6";
    expect(await maxTeams()).toBe(6);
  });
});

describe("setMaxTeams()", () => {
  it("row가 없으면 새로 만든다", async () => {
    await setMaxTeams(9, "ha");
    expect(db.setting).toMatchObject({ id: "singleton", maxTeams: 9, updatedBy: "ha" });
    expect(await maxTeams()).toBe(9);
  });

  it("이미 있으면 덮어쓴다(멱등)", async () => {
    await setMaxTeams(9, "ha");
    await setMaxTeams(4, "bak");
    expect(db.setting).toMatchObject({ maxTeams: 4, updatedBy: "bak" });
  });
});

describe("범위 상수", () => {
  it("1–100", () => {
    expect(MAX_TEAMS_MIN).toBe(1);
    expect(MAX_TEAMS_MAX).toBe(100);
  });
});
```

- [ ] **Step 4: 테스트가 실패하는지 확인**

Run: `npx vitest run lib/__tests__/settings.test.ts`
Expected: FAIL — `Cannot find module '@/lib/settings'`

- [ ] **Step 5: `lib/settings.ts` 구현**

Create `lib/settings.ts`:

```ts
import { prisma } from "@/lib/prisma";

// 전역 앱 설정 (서버 전용, ADR-022). 관리자 콘솔(/admin)이 조절한다.
// CRITICAL: 우선순위는 DB(AppSetting) > env > 코드 기본. ADR-021 개정 —
//   상한은 더 이상 "env로만" 설정하지 않는다. env는 DB row가 없을 때의 폴백으로 남는다.
// CRITICAL: env는 호출 시점에 읽는다(R2). 범위 검증은 호출부(Server Action)의 책임이다.

const SINGLETON_ID = "singleton";
const DEFAULT_MAX_TEAMS = 2;

/** 상한으로 허용하는 범위. UI·Server Action이 함께 참조한다. */
export const MAX_TEAMS_MIN = 1;
export const MAX_TEAMS_MAX = 100;

/** env MAX_TEAMS. 미설정이거나 양의 정수가 아니면 기본 2. */
function envMaxTeams(): number {
  const raw = process.env.MAX_TEAMS;
  if (raw === undefined || raw === "") return DEFAULT_MAX_TEAMS;
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : DEFAULT_MAX_TEAMS;
}

/** 전역 팀 상한. DB > env > 2. */
export async function maxTeams(): Promise<number> {
  const row = await prisma.appSetting.findUnique({ where: { id: SINGLETON_ID } });
  if (row?.maxTeams != null && row.maxTeams > 0) return row.maxTeams;
  return envMaxTeams();
}

/** 전역 팀 상한 저장(멱등 upsert). updatedBy는 세션 memberId(R3). */
export async function setMaxTeams(value: number, updatedBy: string): Promise<void> {
  await prisma.appSetting.upsert({
    where: { id: SINGLETON_ID },
    create: { id: SINGLETON_ID, maxTeams: value, updatedBy },
    update: { maxTeams: value, updatedBy },
  });
}
```

- [ ] **Step 6: 테스트 통과 확인**

Run: `npx vitest run lib/__tests__/settings.test.ts`
Expected: PASS (11 tests)

- [ ] **Step 7: 커밋**

```bash
git add prisma/schema.prisma prisma/migrations lib/settings.ts lib/__tests__/settings.test.ts
git commit -m "feat(settings): AppSetting 단일 row + 전역 팀 상한 DB 우선 조회"
```

---

### Task 2: `lib/teams.ts`를 비동기 `maxTeams()`로 전환

**Files:**
- Modify: `lib/teams.ts:11-22`, `lib/teams.ts:64`, `lib/teams.ts:82`
- Test: `lib/__tests__/teams.test.ts` (수정)

**Interfaces:**
- Consumes: `maxTeams()` from `@/lib/settings` (Task 1)
- Produces: `canCreateTeam(): Promise<boolean>`, `createTeam(...)` — 시그니처 변화 없음. `lib/teams.ts`는 더 이상 `maxTeams`를 export하지 않는다.

- [ ] **Step 1: 테스트를 새 계약에 맞게 고친다**

`lib/__tests__/teams.test.ts`를 세 군데 수정한다.

**(a)** prisma 목에 `appSetting`을 추가한다. `lib/settings.ts`가 `prisma.appSetting.findUnique`를 부르는데 목에 없으면 전부 터진다. `vi.mock("@/lib/prisma", ...)` 블록의 반환 객체에 아래를 추가:

```ts
    appSetting: {
      // 이 파일은 env 폴백 경로만 검증한다 — DB row는 항상 없음.
      findUnique: vi.fn(async () => null),
    },
```

**(b)** import 목록(현재 `lib/__tests__/teams.test.ts:131`)에서 `maxTeams,` 줄을 **삭제**한다. `lib/teams.ts`가 더 이상 export하지 않는다.

**(c)** `describe("maxTeams()", ...)` 블록 전체(현재 `lib/__tests__/teams.test.ts:156-173`)를 **삭제**한다. 이 검증은 `lib/__tests__/settings.test.ts`가 담당한다.

나머지(`canCreateTeam` 3건, `createTeam`의 `TEAM_LIMIT` 1건)는 env 폴백 경로라 **그대로 통과해야 한다** — 손대지 않는다.

- [ ] **Step 2: 테스트가 실패하는지 확인**

Run: `npx vitest run lib/__tests__/teams.test.ts`
Expected: FAIL — `lib/teams.ts`가 아직 동기 `maxTeams()`를 쓰므로 import 에러 또는 상한 비교 실패

- [ ] **Step 3: `lib/teams.ts` 수정**

`lib/teams.ts:11-17`의 `maxTeams()` 함수 정의를 **삭제**하고, 상단 import에 추가한다:

```ts
import { maxTeams } from "@/lib/settings";
```

파일 상단 주석(`lib/teams.ts:6` 부근)에 한 줄 덧붙인다:

```ts
// CRITICAL: 전역 상한은 lib/settings.ts가 소유한다(DB > env > 2, ADR-022). 여기서 env를 직접 읽지 마라.
```

`canCreateTeam()`(현재 `lib/teams.ts:20-22`):

```ts
/** 전역 팀 생성 가능 여부 — 서버 전체 team.count()가 maxTeams() 미만이면 true. (per-user 아님, ADR-021) */
export async function canCreateTeam(): Promise<boolean> {
  return (await prisma.team.count()) < (await maxTeams());
}
```

`createTeam()`의 1차 확인(현재 `lib/teams.ts:64`):

```ts
  if ((await prisma.team.count()) >= (await maxTeams())) {
```

트랜잭션 내 재확인(현재 `lib/teams.ts:82`):

```ts
    if ((await tx.team.count()) >= (await maxTeams())) {
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx vitest run lib/__tests__/teams.test.ts lib/__tests__/settings.test.ts`
Expected: PASS (양쪽 모두)

- [ ] **Step 5: 전체 타입체크 — 다른 호출부가 깨지지 않았는지**

Run: `npx tsc --noEmit`
Expected: 에러 0건. `maxTeams`를 import하던 곳이 남아 있으면 여기서 잡힌다.

- [ ] **Step 6: 커밋**

```bash
git add lib/teams.ts lib/__tests__/teams.test.ts
git commit -m "refactor(teams): maxTeams()를 lib/settings의 비동기 조회로 전환"
```

---

### Task 3: `requireSuperAdmin()` 관리자 게이트

**Files:**
- Modify: `lib/auth.ts` (파일 끝에 추가)
- Test: `lib/__tests__/auth.test.ts` (수정)

**Interfaces:**
- Consumes: `getSession()`, `HttpError`, `prisma`
- Produces: `requireSuperAdmin(): Promise<Session>` — 실패 시 `HttpError(404, "NOT_FOUND", ...)` throw

- [ ] **Step 1: 기존 prisma 목을 이메일까지 돌려주도록 바꾼다**

현재 목(`lib/__tests__/auth.test.ts:19-27`)은 `{ id: "ha", role: "관리자" }`를 하드코딩해 돌려줘서 **email이 없다**. 테스트별로 멤버를 갈아끼울 수 있게 hoisted 맵으로 바꾼다.

`lib/__tests__/auth.test.ts:5`의 `vi.hoisted` 블록을 교체:

```ts
const { members, store } = vi.hoisted(() => ({
  store: new Map<string, string>(),
  members: new Map<string, { id: string; role: string; email: string }>(),
}));
```

`lib/__tests__/auth.test.ts:19-27`의 prisma 목을 교체:

```ts
vi.mock("@/lib/prisma", () => ({
  prisma: {
    member: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => members.get(where.id) ?? null),
    },
  },
}));
```

`beforeEach`(현재 `lib/__tests__/auth.test.ts:42-44`)를 교체:

```ts
beforeEach(() => {
  store.clear();
  members.clear();
  members.set("ha", { id: "ha", role: "관리자", email: "de8167@gmail.com" });
});
```

이러면 기존 4+3개 테스트는 그대로 통과한다(`ha` → 관리자, `ghost` → null).

- [ ] **Step 2: 실패하는 테스트 작성**

`lib/__tests__/auth.test.ts` 끝에 추가한다. import 목록(현재 `lib/__tests__/auth.test.ts:29-35`)에 `requireSuperAdmin`을 추가하고, vitest import에 `afterEach`를 추가한다.

```ts
describe("requireSuperAdmin()", () => {
  const ORIGINAL_ADMIN = process.env.ADMIN_EMAIL;

  afterEach(() => {
    if (ORIGINAL_ADMIN === undefined) delete process.env.ADMIN_EMAIL;
    else process.env.ADMIN_EMAIL = ORIGINAL_ADMIN;
  });

  it("ADMIN_EMAIL과 Member.email이 같으면 통과한다", async () => {
    process.env.ADMIN_EMAIL = "de8167@gmail.com";
    await createSession("ha");
    await expect(requireSuperAdmin()).resolves.toEqual({ memberId: "ha", role: "관리자" });
  });

  it("대소문자·공백 차이는 무시한다", async () => {
    process.env.ADMIN_EMAIL = "  DE8167@Gmail.com ";
    await createSession("ha");
    await expect(requireSuperAdmin()).resolves.toMatchObject({ memberId: "ha" });
  });

  it("이메일이 다르면 404를 던진다(403 아님 — 존재 은닉)", async () => {
    process.env.ADMIN_EMAIL = "de8167@gmail.com";
    members.set("bak", { id: "bak", role: "멤버", email: "someone@else.com" });
    await createSession("bak");
    const e = await requireSuperAdmin().catch((err) => err);
    expect(e).toBeInstanceOf(HttpError);
    expect(e.status).toBe(404);
    expect(e.code).toBe("NOT_FOUND");
  });

  it("role이 관리자여도 이메일이 다르면 막는다", async () => {
    process.env.ADMIN_EMAIL = "de8167@gmail.com";
    members.set("jo", { id: "jo", role: "관리자", email: "jo@habakjopaeng.team" });
    await createSession("jo");
    await expect(requireSuperAdmin()).rejects.toBeInstanceOf(HttpError);
  });

  it("미인증이면 404를 던진다", async () => {
    process.env.ADMIN_EMAIL = "de8167@gmail.com";
    const e = await requireSuperAdmin().catch((err) => err);
    expect(e.status).toBe(404);
  });

  it("ADMIN_EMAIL 미설정이면 기본값 de8167@gmail.com을 쓴다", async () => {
    delete process.env.ADMIN_EMAIL;
    await createSession("ha");
    await expect(requireSuperAdmin()).resolves.toMatchObject({ memberId: "ha" });
  });
});
```

- [ ] **Step 3: 테스트가 실패하는지 확인**

Run: `npx vitest run lib/__tests__/auth.test.ts`
Expected: FAIL — `requireSuperAdmin is not a function`. 기존 세션 테스트들은 **PASS**여야 한다(목 교체가 회귀를 내지 않았다는 증거).

- [ ] **Step 4: `lib/auth.ts`에 구현 추가**

파일 끝(`requireRole` 아래)에 추가한다:

```ts
const DEFAULT_ADMIN_EMAIL = "de8167@gmail.com";

/** 콘솔 접근이 허용된 관리자 이메일(정규화됨). 호출 시점에 env를 읽는다(R2). */
function adminEmail(): string {
  const raw = process.env.ADMIN_EMAIL;
  const value = raw === undefined || raw === "" ? DEFAULT_ADMIN_EMAIL : raw;
  return value.trim().toLowerCase();
}

/**
 * 관리자 콘솔(/admin) 가드. Member.email이 ADMIN_EMAIL과 같을 때만 통과한다.
 * CRITICAL: Member.role이 아니라 이메일로 판정한다 — role은 DB에서 승격될 수 있다.
 * CRITICAL: 실패는 403이 아니라 404다 — 콘솔의 존재 자체를 숨긴다.
 *   notFound() 호출은 여기가 아니라 페이지가 한다(라이브러리를 Next 렌더 API에 묶지 않는다).
 */
export async function requireSuperAdmin(): Promise<Session> {
  const notFound = () => new HttpError(404, "NOT_FOUND", "페이지를 찾을 수 없어요.");

  const session = await getSession();
  if (!session) throw notFound();

  const member = await prisma.member.findUnique({
    where: { id: session.memberId },
    select: { email: true },
  });
  if (member?.email.trim().toLowerCase() !== adminEmail()) throw notFound();

  return session;
}
```

- [ ] **Step 5: 테스트 통과 확인**

Run: `npx vitest run lib/__tests__/auth.test.ts`
Expected: PASS (기존 7개 + 신규 6개)

- [ ] **Step 6: 커밋**

```bash
git add lib/auth.ts lib/__tests__/auth.test.ts
git commit -m "feat(auth): requireSuperAdmin — ADMIN_EMAIL 일치 게이트, 실패는 404로 은닉"
```

---

### Task 4: 라이브 사용량 집계 `lib/live-usage.ts`

**Files:**
- Create: `lib/live-usage.ts`
- Test: `lib/__tests__/live-usage.test.ts`

**Interfaces:**
- Consumes: `@/lib/prisma`
- Produces:
  - `startOfMonthKST(now?: Date): Date`
  - `startOfMonthKSTAgo(monthsAgo: number, now?: Date): Date`
  - `monthKeyKST(at: Date): string` — `"YYYY-MM"`
  - `liveMinutesQuota(): number`
  - `spanMinutes(p: ParticipantSpan, now: Date): number`
  - `currentMonthUsage(now?: Date): Promise<LiveUsage>`
  - `monthlyTrend(months: number, now?: Date): Promise<{ month: string; minutes: number }[]>`
  - `interface LiveUsage { usedMinutes; limitMinutes; remainingMinutes; byTeam: { teamId; teamName; minutes }[] }`

- [ ] **Step 1: 실패하는 테스트 작성**

Create `lib/__tests__/live-usage.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// 라이브 사용량 추정(ADR-022)을 prisma 인메모리 목으로 검증한다.
// 단위는 참가자-분 — 4명이 30분이면 120분(LiveKit 과금 개념과 동일).
// CRITICAL: 월 경계는 KST 1일 00:00. 세션이 월을 걸치면 joinedAt이 속한 달에 전액 귀속한다.

interface ParticipantRow {
  joinedAt: Date;
  leftAt: Date | null;
  session: { endedAt: Date | null; teamId: string };
}
interface TeamRow {
  id: string;
  name: string;
}

const { db } = vi.hoisted(() => ({
  db: { participants: [] as ParticipantRow[], teams: [] as TeamRow[] },
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    participant: {
      findMany: vi.fn(async ({ where }: { where: { joinedAt: { gte: Date } } }) =>
        db.participants.filter((p) => p.joinedAt >= where.joinedAt.gte),
      ),
    },
    team: {
      findMany: vi.fn(async ({ where }: { where: { id: { in: string[] } } }) =>
        db.teams.filter((t) => where.id.in.includes(t.id)),
      ),
    },
  },
}));

const {
  currentMonthUsage,
  liveMinutesQuota,
  monthKeyKST,
  monthlyTrend,
  spanMinutes,
  startOfMonthKST,
} = await import("@/lib/live-usage");

const ORIGINAL_QUOTA = process.env.LIVE_MINUTES_QUOTA;

/** KST 벽시계 → 실제 UTC 순간. 테스트 가독성용. */
function kst(y: number, mo: number, d: number, h = 0, mi = 0): Date {
  return new Date(Date.UTC(y, mo - 1, d, h - 9, mi));
}

beforeEach(() => {
  db.participants.length = 0;
  db.teams.length = 0;
  delete process.env.LIVE_MINUTES_QUOTA;
});

afterEach(() => {
  if (ORIGINAL_QUOTA === undefined) delete process.env.LIVE_MINUTES_QUOTA;
  else process.env.LIVE_MINUTES_QUOTA = ORIGINAL_QUOTA;
});

describe("startOfMonthKST()", () => {
  it("이번 달 1일 00:00 KST의 UTC 순간을 준다", () => {
    expect(startOfMonthKST(kst(2026, 8, 17, 13, 30))).toEqual(kst(2026, 8, 1));
  });

  it("1일 00:00 KST 정각은 그 순간 그대로(경계 포함)", () => {
    expect(startOfMonthKST(kst(2026, 8, 1))).toEqual(kst(2026, 8, 1));
  });

  it("연말 경계 — 1월은 그 해 1월 1일", () => {
    expect(startOfMonthKST(kst(2026, 1, 3))).toEqual(kst(2026, 1, 1));
  });

  it("KST 1일 00:30은 UTC로는 전달 말일이지만 이번 달로 친다", () => {
    // UTC 기준 2026-07-31T15:30Z = KST 2026-08-01 00:30
    expect(startOfMonthKST(kst(2026, 8, 1, 0, 30))).toEqual(kst(2026, 8, 1));
  });
});

describe("monthKeyKST()", () => {
  it('KST 기준 "YYYY-MM"', () => {
    expect(monthKeyKST(kst(2026, 8, 1, 0, 30))).toBe("2026-08");
    expect(monthKeyKST(kst(2026, 12, 31, 23, 0))).toBe("2026-12");
  });
});

describe("liveMinutesQuota()", () => {
  it("미설정이면 1000", () => {
    expect(liveMinutesQuota()).toBe(1000);
  });

  it("호출 시점에 env를 읽는다(R2)", () => {
    process.env.LIVE_MINUTES_QUOTA = "5000";
    expect(liveMinutesQuota()).toBe(5000);
  });

  it("잘못된 값이면 1000으로 폴백", () => {
    process.env.LIVE_MINUTES_QUOTA = "abc";
    expect(liveMinutesQuota()).toBe(1000);
  });
});

describe("spanMinutes()", () => {
  const now = kst(2026, 8, 17, 12, 0);

  it("leftAt이 있으면 leftAt − joinedAt", () => {
    const p = {
      joinedAt: kst(2026, 8, 17, 10, 0),
      leftAt: kst(2026, 8, 17, 10, 30),
      session: { endedAt: null, teamId: "t1" },
    };
    expect(spanMinutes(p, now)).toBe(30);
  });

  it("leftAt이 없고 세션이 끝났으면 endedAt으로 보정한다", () => {
    const p = {
      joinedAt: kst(2026, 8, 17, 10, 0),
      leftAt: null,
      session: { endedAt: kst(2026, 8, 17, 10, 45), teamId: "t1" },
    };
    expect(spanMinutes(p, now)).toBe(45);
  });

  it("leftAt도 endedAt도 없으면(진행 중) now로 보정한다", () => {
    const p = {
      joinedAt: kst(2026, 8, 17, 11, 0),
      leftAt: null,
      session: { endedAt: null, teamId: "t1" },
    };
    expect(spanMinutes(p, now)).toBe(60);
  });

  it("끝이 시작보다 앞서면 0으로 클램프한다", () => {
    const p = {
      joinedAt: kst(2026, 8, 17, 10, 0),
      leftAt: kst(2026, 8, 17, 9, 0),
      session: { endedAt: null, teamId: "t1" },
    };
    expect(spanMinutes(p, now)).toBe(0);
  });
});

describe("currentMonthUsage()", () => {
  const now = kst(2026, 8, 17, 12, 0);

  it("세션이 없으면 0분", async () => {
    const u = await currentMonthUsage(now);
    expect(u.usedMinutes).toBe(0);
    expect(u.limitMinutes).toBe(1000);
    expect(u.remainingMinutes).toBe(1000);
    expect(u.byTeam).toEqual([]);
  });

  it("참가자 3명 × 10분 = 30분(참가자-분)", async () => {
    db.teams.push({ id: "t1", name: "하박조팽" });
    for (let i = 0; i < 3; i++) {
      db.participants.push({
        joinedAt: kst(2026, 8, 10, 20, 0),
        leftAt: kst(2026, 8, 10, 20, 10),
        session: { endedAt: kst(2026, 8, 10, 20, 10), teamId: "t1" },
      });
    }
    const u = await currentMonthUsage(now);
    expect(u.usedMinutes).toBe(30);
    expect(u.remainingMinutes).toBe(970);
    expect(u.byTeam).toEqual([{ teamId: "t1", teamName: "하박조팽", minutes: 30 }]);
  });

  it("지난달 참가자는 제외한다", async () => {
    db.teams.push({ id: "t1", name: "하박조팽" });
    db.participants.push({
      joinedAt: kst(2026, 7, 31, 23, 0),
      leftAt: kst(2026, 7, 31, 23, 30),
      session: { endedAt: kst(2026, 7, 31, 23, 30), teamId: "t1" },
    });
    expect((await currentMonthUsage(now)).usedMinutes).toBe(0);
  });

  it("팀별 분해 합이 전체 합과 같고, 많이 쓴 팀이 앞에 온다", async () => {
    db.teams.push({ id: "t1", name: "하박조팽" }, { id: "t2", name: "비전랩" });
    db.participants.push({
      joinedAt: kst(2026, 8, 5, 9, 0),
      leftAt: kst(2026, 8, 5, 9, 20),
      session: { endedAt: kst(2026, 8, 5, 9, 20), teamId: "t1" },
    });
    db.participants.push({
      joinedAt: kst(2026, 8, 6, 9, 0),
      leftAt: kst(2026, 8, 6, 10, 0),
      session: { endedAt: kst(2026, 8, 6, 10, 0), teamId: "t2" },
    });
    const u = await currentMonthUsage(now);
    expect(u.usedMinutes).toBe(80);
    expect(u.byTeam.reduce((s, t) => s + t.minutes, 0)).toBe(80);
    expect(u.byTeam[0]).toEqual({ teamId: "t2", teamName: "비전랩", minutes: 60 });
  });

  it("한도를 넘겨도 remaining은 0 아래로 안 간다", async () => {
    process.env.LIVE_MINUTES_QUOTA = "10";
    db.teams.push({ id: "t1", name: "하박조팽" });
    db.participants.push({
      joinedAt: kst(2026, 8, 5, 9, 0),
      leftAt: kst(2026, 8, 5, 10, 0),
      session: { endedAt: kst(2026, 8, 5, 10, 0), teamId: "t1" },
    });
    const u = await currentMonthUsage(now);
    expect(u.usedMinutes).toBe(60);
    expect(u.remainingMinutes).toBe(0);
  });

  it("팀이 삭제돼 이름을 못 찾으면 '(삭제된 팀)'으로 표시한다", async () => {
    db.participants.push({
      joinedAt: kst(2026, 8, 5, 9, 0),
      leftAt: kst(2026, 8, 5, 9, 5),
      session: { endedAt: kst(2026, 8, 5, 9, 5), teamId: "gone" },
    });
    const u = await currentMonthUsage(now);
    expect(u.byTeam[0].teamName).toBe("(삭제된 팀)");
  });
});

describe("monthlyTrend()", () => {
  const now = kst(2026, 8, 17, 12, 0);

  it("사용 없는 달도 0으로 채우고 오래된 달부터 정렬한다", async () => {
    const t = await monthlyTrend(3, now);
    expect(t.map((x) => x.month)).toEqual(["2026-06", "2026-07", "2026-08"]);
    expect(t.every((x) => x.minutes === 0)).toBe(true);
  });

  it("joinedAt이 속한 달에 귀속한다", async () => {
    db.participants.push({
      joinedAt: kst(2026, 7, 10, 9, 0),
      leftAt: kst(2026, 7, 10, 9, 30),
      session: { endedAt: kst(2026, 7, 10, 9, 30), teamId: "t1" },
    });
    const t = await monthlyTrend(3, now);
    expect(t.find((x) => x.month === "2026-07")?.minutes).toBe(30);
    expect(t.find((x) => x.month === "2026-08")?.minutes).toBe(0);
  });

  it("월을 걸친 세션은 joinedAt의 달에 전액 귀속한다(분할 안 함)", async () => {
    db.participants.push({
      joinedAt: kst(2026, 7, 31, 23, 30),
      leftAt: kst(2026, 8, 1, 0, 30),
      session: { endedAt: kst(2026, 8, 1, 0, 30), teamId: "t1" },
    });
    const t = await monthlyTrend(3, now);
    expect(t.find((x) => x.month === "2026-07")?.minutes).toBe(60);
    expect(t.find((x) => x.month === "2026-08")?.minutes).toBe(0);
  });
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

Run: `npx vitest run lib/__tests__/live-usage.test.ts`
Expected: FAIL — `Cannot find module '@/lib/live-usage'`

- [ ] **Step 3: `lib/live-usage.ts` 구현**

Create `lib/live-usage.ts`:

```ts
import { prisma } from "@/lib/prisma";

// 라이브 사용량 추정 (서버 전용, ADR-022). 관리자 콘솔(/admin)이 소비한다.
// 단위는 참가자-분 — LiveKit 과금 개념과 같다(4명 × 30분 = 120분).
// CRITICAL: 이 값은 추정치다. UI에 반드시 "추정치"로 표기한다.
//   ① 재참가가 Participant 행을 덮어써(leftAt=null) 이전 체류 구간이 소실된다 → 과소집계.
//   ② 탭을 닫으면 /leave가 안 불려 leftAt이 null로 남는다 → endedAt으로 보정(과대집계 가능).
//   정확한 값이 필요하면 LiveKit Analytics API 연동을 별도로 검토한다.
// CRITICAL: 월 경계는 KST 1일 00:00(lib/rate-limit.ts의 주간 경계와 같은 방식).
//   월을 걸친 세션은 joinedAt이 속한 달에 전액 귀속한다 — 분할하지 않는다.

const KST_OFFSET_MS = 9 * 60 * 60 * 1000; // KST = UTC+9
const DEFAULT_LIVE_MINUTES_QUOTA = 1000; // LiveKit 무료 한도

export interface ParticipantSpan {
  joinedAt: Date;
  leftAt: Date | null;
  session: { endedAt: Date | null; teamId: string };
}

export interface LiveUsage {
  usedMinutes: number;
  limitMinutes: number;
  remainingMinutes: number;
  byTeam: { teamId: string; teamName: string; minutes: number }[];
}

/** monthsAgo개월 전 1일 00:00 KST의 UTC 순간. 0이면 이번 달. */
export function startOfMonthKSTAgo(monthsAgo: number, now: Date = new Date()): Date {
  const kst = new Date(now.getTime() + KST_OFFSET_MS);
  // 음수 월은 Date.UTC가 연도까지 정규화한다.
  const firstKst = Date.UTC(kst.getUTCFullYear(), kst.getUTCMonth() - monthsAgo, 1);
  return new Date(firstKst - KST_OFFSET_MS);
}

/** 이번 달 시작(1일 00:00 KST)의 UTC 순간. 경계는 포함. */
export function startOfMonthKST(now: Date = new Date()): Date {
  return startOfMonthKSTAgo(0, now);
}

/** KST 기준 "YYYY-MM". */
export function monthKeyKST(at: Date): string {
  const kst = new Date(at.getTime() + KST_OFFSET_MS);
  return `${kst.getUTCFullYear()}-${String(kst.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** 월 라이브 한도(분). 미설정/오류면 1000. 호출 시점에 env를 읽는다(R2). */
export function liveMinutesQuota(): number {
  const raw = process.env.LIVE_MINUTES_QUOTA;
  if (raw === undefined || raw === "") return DEFAULT_LIVE_MINUTES_QUOTA;
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : DEFAULT_LIVE_MINUTES_QUOTA;
}

/** 참가자 한 명의 체류 분(추정). leftAt → endedAt → now 순으로 끝을 정하고 음수는 0. */
export function spanMinutes(p: ParticipantSpan, now: Date): number {
  const end = p.leftAt ?? p.session.endedAt ?? now;
  const ms = end.getTime() - p.joinedAt.getTime();
  return ms <= 0 ? 0 : Math.round(ms / 60_000);
}

/** since 이후 joinedAt을 가진 참가자 구간(세션의 endedAt·teamId 포함). */
async function spansSince(since: Date): Promise<ParticipantSpan[]> {
  return prisma.participant.findMany({
    where: { joinedAt: { gte: since } },
    select: {
      joinedAt: true,
      leftAt: true,
      session: { select: { endedAt: true, teamId: true } },
    },
  });
}

/** 이번 달(KST) 참가자-분 추정 + 팀별 분해. byTeam은 많이 쓴 팀부터. */
export async function currentMonthUsage(now: Date = new Date()): Promise<LiveUsage> {
  const spans = await spansSince(startOfMonthKST(now));

  const perTeam = new Map<string, number>();
  let usedMinutes = 0;
  for (const s of spans) {
    const m = spanMinutes(s, now);
    usedMinutes += m;
    perTeam.set(s.session.teamId, (perTeam.get(s.session.teamId) ?? 0) + m);
  }

  const teamIds = [...perTeam.keys()];
  const teams = teamIds.length
    ? await prisma.team.findMany({ where: { id: { in: teamIds } }, select: { id: true, name: true } })
    : [];
  const nameById = new Map(teams.map((t) => [t.id, t.name]));

  const limitMinutes = liveMinutesQuota();
  return {
    usedMinutes,
    limitMinutes,
    remainingMinutes: Math.max(0, limitMinutes - usedMinutes),
    byTeam: [...perTeam.entries()]
      .map(([teamId, minutes]) => ({
        teamId,
        teamName: nameById.get(teamId) ?? "(삭제된 팀)",
        minutes,
      }))
      .sort((a, b) => b.minutes - a.minutes),
  };
}

/** 최근 months개월 추이. 오래된 달 → 최근 달 순, 사용 없는 달도 0으로 채운다. */
export async function monthlyTrend(
  months: number,
  now: Date = new Date(),
): Promise<{ month: string; minutes: number }[]> {
  const byMonth = new Map<string, number>();
  for (let i = months - 1; i >= 0; i--) {
    byMonth.set(monthKeyKST(startOfMonthKSTAgo(i, now)), 0);
  }

  const spans = await spansSince(startOfMonthKSTAgo(months - 1, now));
  for (const s of spans) {
    const key = monthKeyKST(s.joinedAt);
    const prev = byMonth.get(key);
    if (prev !== undefined) byMonth.set(key, prev + spanMinutes(s, now));
  }

  return [...byMonth.entries()].map(([month, minutes]) => ({ month, minutes }));
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx vitest run lib/__tests__/live-usage.test.ts`
Expected: PASS (전 케이스)

- [ ] **Step 5: 커밋**

```bash
git add lib/live-usage.ts lib/__tests__/live-usage.test.ts
git commit -m "feat(live): 월별 참가자-분 사용량 추정 집계(KST 월 경계)"
```

---

### Task 5: `setMaxTeamsAction` Server Action

**Files:**
- Create: `app/admin/actions.ts`
- Test: `app/admin/__tests__/actions.test.ts`

**Interfaces:**
- Consumes: `requireSuperAdmin()` (Task 3), `setMaxTeams`/`MAX_TEAMS_MIN`/`MAX_TEAMS_MAX` (Task 1)
- Produces: `setMaxTeamsAction(input: { value: number }): Promise<SetMaxTeamsResult>`
  - `type SetMaxTeamsResult = { ok: true; value: number } | { ok: false; code: string; message: string }`
  - 코드: `NOT_FOUND` | `INVALID_RANGE` | `BELOW_CURRENT`

- [ ] **Step 1: 실패하는 테스트 작성**

Create `app/admin/__tests__/actions.test.ts`. 기존 액션 테스트(`app/invite/[token]/__tests__/accept-action.test.ts`)의 목 관용구를 그대로 따른다.

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

// 상한 조절 Server Action 검증: 권한(R19) · 범위 · 현재 팀 수 하회 금지 · 판별 유니온(R30).
// CRITICAL: 권한 실패는 403이 아니라 NOT_FOUND — 콘솔 존재를 숨긴다.

const { requireSuperAdminMock, setMaxTeamsMock, teamCountMock } = vi.hoisted(() => ({
  requireSuperAdminMock: vi.fn(),
  setMaxTeamsMock: vi.fn(),
  teamCountMock: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ requireSuperAdmin: requireSuperAdminMock }));
vi.mock("@/lib/settings", () => ({
  setMaxTeams: setMaxTeamsMock,
  MAX_TEAMS_MIN: 1,
  MAX_TEAMS_MAX: 100,
}));
vi.mock("@/lib/prisma", () => ({ prisma: { team: { count: teamCountMock } } }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const { setMaxTeamsAction } = await import("../actions");

beforeEach(() => {
  vi.clearAllMocks();
  requireSuperAdminMock.mockResolvedValue({ memberId: "ha", role: "관리자" });
  teamCountMock.mockResolvedValue(2);
});

it("관리자가 아니면 NOT_FOUND를 돌려준다(던지지 않음)", async () => {
  requireSuperAdminMock.mockRejectedValue(new Error("nope"));
  await expect(setMaxTeamsAction({ value: 5 })).resolves.toEqual({
    ok: false,
    code: "NOT_FOUND",
    message: "페이지를 찾을 수 없어요.",
  });
  expect(setMaxTeamsMock).not.toHaveBeenCalled();
});

it("정상 값이면 저장하고 ok를 돌려준다", async () => {
  await expect(setMaxTeamsAction({ value: 5 })).resolves.toEqual({ ok: true, value: 5 });
  // updatedBy는 클라 입력이 아니라 세션에서(R3).
  expect(setMaxTeamsMock).toHaveBeenCalledWith(5, "ha");
});

it("현재 팀 수보다 작으면 BELOW_CURRENT", async () => {
  teamCountMock.mockResolvedValue(3);
  const r = await setMaxTeamsAction({ value: 2 });
  expect(r).toMatchObject({ ok: false, code: "BELOW_CURRENT" });
  expect(r.ok === false && r.message).toContain("3개");
  expect(setMaxTeamsMock).not.toHaveBeenCalled();
});

it("현재 팀 수와 같은 값은 허용한다(경계)", async () => {
  teamCountMock.mockResolvedValue(3);
  await expect(setMaxTeamsAction({ value: 3 })).resolves.toEqual({ ok: true, value: 3 });
});

it("0 이하는 INVALID_RANGE", async () => {
  await expect(setMaxTeamsAction({ value: 0 })).resolves.toMatchObject({
    ok: false,
    code: "INVALID_RANGE",
  });
});

it("100 초과는 INVALID_RANGE", async () => {
  await expect(setMaxTeamsAction({ value: 101 })).resolves.toMatchObject({
    ok: false,
    code: "INVALID_RANGE",
  });
});

it("정수가 아니면 INVALID_RANGE", async () => {
  await expect(setMaxTeamsAction({ value: 2.5 })).resolves.toMatchObject({
    ok: false,
    code: "INVALID_RANGE",
  });
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

Run: `npx vitest run app/admin/__tests__/actions.test.ts`
Expected: FAIL — `Cannot find module '../actions'`

- [ ] **Step 3: `app/admin/actions.ts` 구현**

```ts
"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireSuperAdmin } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { MAX_TEAMS_MAX, MAX_TEAMS_MIN, setMaxTeams } from "@/lib/settings";

// 전역 팀 상한 조절 Server Action (쓰기 = Server Action, ADR-015/R32).
// CRITICAL: Server Action은 페이지와 별개의 진입점이다 — 여기서 권한을 다시 강제한다(R19).
// CRITICAL: 권한 실패도 NOT_FOUND로 돌려준다 — 콘솔의 존재를 노출하지 않는다.
// CRITICAL: updatedBy는 세션에서 취한다(R3). 결과는 판별 유니온 → UI가 인라인 처리(R30).

export type SetMaxTeamsResult =
  | { ok: true; value: number }
  | { ok: false; code: string; message: string };

const SetMaxTeamsSchema = z.object({
  value: z.number().int().min(MAX_TEAMS_MIN).max(MAX_TEAMS_MAX),
});

export async function setMaxTeamsAction(input: { value: number }): Promise<SetMaxTeamsResult> {
  let session;
  try {
    session = await requireSuperAdmin();
  } catch {
    return { ok: false, code: "NOT_FOUND", message: "페이지를 찾을 수 없어요." };
  }

  const parsed = SetMaxTeamsSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      code: "INVALID_RANGE",
      message: `${MAX_TEAMS_MIN}–${MAX_TEAMS_MAX} 사이의 정수로 입력해주세요.`,
    };
  }

  // 이미 만들어진 팀을 상한 미만으로 남기지 않는다 — 줄이려면 팀을 먼저 지워야 한다.
  const current = await prisma.team.count();
  if (parsed.data.value < current) {
    return {
      ok: false,
      code: "BELOW_CURRENT",
      message: `이미 만들어진 팀이 ${current}개예요. 그보다 작게는 못 줄여요.`,
    };
  }

  await setMaxTeams(parsed.data.value, session.memberId);
  revalidatePath("/admin");
  revalidatePath("/teams"); // 팀 허브의 canCreate 가시화도 갱신한다.
  return { ok: true, value: parsed.data.value };
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx vitest run app/admin/__tests__/actions.test.ts`
Expected: PASS (7 tests)

- [ ] **Step 5: 커밋**

```bash
git add app/admin/actions.ts app/admin/__tests__/actions.test.ts
git commit -m "feat(admin): 전역 팀 상한 조절 Server Action(범위·현재 팀 수 가드)"
```

---

### Task 6: `/admin` 화면 (페이지 + 사용량 패널 + 상한 폼)

**Files:**
- Create: `app/admin/page.tsx`
- Create: `app/admin/usage-panel.tsx`
- Create: `app/admin/max-teams-form.tsx`
- Test: `app/admin/__tests__/max-teams-form.test.tsx`
- Test: `app/admin/__tests__/usage-panel.test.tsx`

**Interfaces:**
- Consumes: `currentMonthUsage`/`monthlyTrend`/`LiveUsage` (Task 4), `maxTeams` (Task 1), `requireSuperAdmin` (Task 3), `setMaxTeamsAction` (Task 5)
- Produces: 라우트 `/admin`

- [ ] **Step 1: 폼의 실패하는 테스트 작성**

Create `app/admin/__tests__/max-teams-form.test.tsx`. 기존 `app/teams/__tests__/create-team-form.test.tsx`의 관용구를 따른다.

```tsx
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

// 상한 조절 폼: 실패는 토스트가 아니라 인라인(R30). 현재 값이 입력에 프리필된다.

const { actionMock } = vi.hoisted(() => ({ actionMock: vi.fn() }));
vi.mock("../actions", () => ({ setMaxTeamsAction: actionMock }));

const { MaxTeamsForm } = await import("../max-teams-form");

beforeEach(() => {
  vi.clearAllMocks();
  actionMock.mockResolvedValue({ ok: true, value: 5 });
});

it("현재 상한이 입력에 프리필된다", () => {
  render(<MaxTeamsForm current={3} teamCount={2} />);
  expect(screen.getByLabelText(/전역 팀 상한/)).toHaveValue(3);
});

it("저장하면 입력값으로 액션을 호출한다", async () => {
  render(<MaxTeamsForm current={3} teamCount={2} />);
  fireEvent.change(screen.getByLabelText(/전역 팀 상한/), { target: { value: "5" } });
  fireEvent.click(screen.getByRole("button", { name: "저장" }));
  await waitFor(() => expect(actionMock).toHaveBeenCalledWith({ value: 5 }));
});

it("성공하면 인라인 성공 메시지를 보여준다", async () => {
  render(<MaxTeamsForm current={3} teamCount={2} />);
  fireEvent.click(screen.getByRole("button", { name: "저장" }));
  expect(await screen.findByText(/저장했어요/)).toBeInTheDocument();
});

it("실패하면 서버 메시지를 인라인으로 보여준다(토스트 아님)", async () => {
  actionMock.mockResolvedValue({
    ok: false,
    code: "BELOW_CURRENT",
    message: "이미 만들어진 팀이 3개예요. 그보다 작게는 못 줄여요.",
  });
  render(<MaxTeamsForm current={3} teamCount={3} />);
  fireEvent.click(screen.getByRole("button", { name: "저장" }));
  expect(await screen.findByText(/그보다 작게는 못 줄여요/)).toBeInTheDocument();
});

it("현재 팀 수를 안내로 보여준다", () => {
  render(<MaxTeamsForm current={3} teamCount={2} />);
  expect(screen.getByText(/현재 2개/)).toBeInTheDocument();
});
```

- [ ] **Step 2: 사용량 패널의 실패하는 테스트 작성**

Create `app/admin/__tests__/usage-panel.test.tsx`:

```tsx
import { expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";

// 사용량 패널: 추정치 표기(필수) · 한도 대비 표시 · 팀별 분해 · 빈 상태.

const { UsagePanel } = await import("../usage-panel");

const USAGE = {
  usedMinutes: 240,
  limitMinutes: 1000,
  remainingMinutes: 760,
  byTeam: [{ teamId: "t1", teamName: "하박조팽", minutes: 240 }],
};
const TREND = [
  { month: "2026-07", minutes: 100 },
  { month: "2026-08", minutes: 240 },
];

it("사용량과 한도를 보여준다", () => {
  render(<UsagePanel usage={USAGE} trend={TREND} />);
  // "240분"은 큰 숫자·월별 추이·팀별에 모두 나온다 — status 영역으로 좁혀서 단언한다.
  const status = within(screen.getByRole("status"));
  expect(status.getByText(/240분/)).toBeInTheDocument();
  expect(status.getByText(/1,000분/)).toBeInTheDocument();
  expect(status.getByText(/760분/)).toBeInTheDocument();
});

it("추정치임을 반드시 표기한다", () => {
  render(<UsagePanel usage={USAGE} trend={TREND} />);
  expect(screen.getByText(/추정치/)).toBeInTheDocument();
});

it("팀별 분해를 보여준다", () => {
  render(<UsagePanel usage={USAGE} trend={TREND} />);
  expect(screen.getByText("하박조팽")).toBeInTheDocument();
});

it("사용량이 없으면 빈 상태 문구를 보여준다", () => {
  render(
    <UsagePanel
      usage={{ usedMinutes: 0, limitMinutes: 1000, remainingMinutes: 1000, byTeam: [] }}
      trend={TREND}
    />,
  );
  expect(screen.getByText(/이번 달 라이브 사용 기록이 없어요/)).toBeInTheDocument();
});

it("한도의 80%를 넘으면 경고 표시를 붙인다", () => {
  render(
    <UsagePanel
      usage={{ usedMinutes: 900, limitMinutes: 1000, remainingMinutes: 100, byTeam: [] }}
      trend={TREND}
    />,
  );
  expect(screen.getByRole("status")).toHaveAttribute("data-level", "warn");
});

it("한도를 다 쓰면 위험 표시를 붙인다", () => {
  render(
    <UsagePanel
      usage={{ usedMinutes: 1000, limitMinutes: 1000, remainingMinutes: 0, byTeam: [] }}
      trend={TREND}
    />,
  );
  expect(screen.getByRole("status")).toHaveAttribute("data-level", "danger");
});
```

- [ ] **Step 3: 두 테스트가 실패하는지 확인**

Run: `npx vitest run app/admin/__tests__/`
Expected: FAIL — `Cannot find module '../max-teams-form'`, `'../usage-panel'`

- [ ] **Step 4: `app/admin/max-teams-form.tsx` 구현**

```tsx
"use client";

import { useState } from "react";
import { Button, Input } from "@/components/ui";
import { setMaxTeamsAction } from "./actions";

// 전역 팀 상한 조절 폼(ADR-022). 서버가 최종 강제 — 여기 검증은 가시화일 뿐이다.
// CRITICAL: 실패는 토스트가 아니라 인라인 메시지로(R30).

type Feedback = { tone: "ok" | "error"; text: string } | null;

export function MaxTeamsForm({ current, teamCount }: { current: number; teamCount: number }) {
  const [value, setValue] = useState(String(current));
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    setFeedback(null);
    const result = await setMaxTeamsAction({ value: Number(value) });
    setSaving(false);
    setFeedback(
      result.ok
        ? { tone: "ok", text: `저장했어요. 이제 최대 ${result.value}개까지 만들 수 있어요.` }
        : { tone: "error", text: result.message },
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <label htmlFor="max-teams" className="text-[13px] font-medium text-fg">
        전역 팀 상한
      </label>
      <div className="flex items-center gap-2">
        <Input
          id="max-teams"
          type="number"
          min={1}
          max={100}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          className="w-24"
        />
        <Button type="button" onClick={save} disabled={saving}>
          저장
        </Button>
      </div>
      <p className="text-[12px] text-fg-subtle">
        서버 전체 기준이에요(사용자별 아님). 현재 {teamCount}개 만들어져 있어요.
      </p>
      {feedback && (
        <p
          className={`text-[13px] ${feedback.tone === "ok" ? "text-fg-muted" : "text-busy"}`}
          role="alert"
        >
          {feedback.text}
        </p>
      )}
    </div>
  );
}
```

- [ ] **Step 5: `app/admin/usage-panel.tsx` 구현**

```tsx
import type { LiveUsage } from "@/lib/live-usage";

// 라이브 사용량 표시(읽기 전용 서버 컴포넌트, ADR-022).
// CRITICAL: "추정치" 표기를 빼지 마라 — 재참가 병합·leftAt 누락으로 실제 과금과 다를 수 있다.

/** 한도 대비 소진 수준. 80% 이상 warn, 100% 이상 danger. */
function level(used: number, limit: number): "ok" | "warn" | "danger" {
  if (limit <= 0) return "ok";
  const ratio = used / limit;
  if (ratio >= 1) return "danger";
  return ratio >= 0.8 ? "warn" : "ok";
}

// 프로젝트 색 토큰(app/globals.css) — 별도 danger/warning 토큰이 없어 presence 토큰을 재사용한다.
const BAR_TONE = {
  ok: "bg-accent",
  warn: "bg-away",
  danger: "bg-busy",
} as const;

export function UsagePanel({
  usage,
  trend,
}: {
  usage: LiveUsage;
  trend: { month: string; minutes: number }[];
}) {
  const tone = level(usage.usedMinutes, usage.limitMinutes);
  const percent = Math.min(100, Math.round((usage.usedMinutes / usage.limitMinutes) * 100));
  const fmt = (n: number) => `${n.toLocaleString("ko-KR")}분`;
  const maxTrend = Math.max(1, ...trend.map((t) => t.minutes));

  return (
    <section className="flex flex-col gap-4">
      <div className="flex items-baseline justify-between">
        <h2 className="text-[15px] font-semibold text-fg">이번 달 라이브 사용량</h2>
        <span className="rounded-full border border-border-token px-2 py-0.5 text-[11px] text-fg-subtle">
          추정치
        </span>
      </div>

      <div role="status" data-level={tone} className="flex flex-col gap-2">
        <div className="flex items-baseline gap-2">
          <span className="text-[24px] font-bold tracking-[-0.02em] text-fg">
            {fmt(usage.usedMinutes)}
          </span>
          <span className="text-[13px] text-fg-muted">/ {fmt(usage.limitMinutes)}</span>
        </div>
        <div className="h-2 w-full overflow-hidden rounded-full bg-bg-elevated">
          <div className={`h-full ${BAR_TONE[tone]}`} style={{ width: `${percent}%` }} />
        </div>
        <p className="text-[13px] text-fg-muted">{fmt(usage.remainingMinutes)} 남았어요.</p>
      </div>

      <p className="text-[12px] text-fg-subtle">
        참가자-분 기준이에요(4명이 30분이면 120분). 재참가·비정상 종료 때문에 실제 LiveKit 과금과
        다를 수 있어요.
      </p>

      <div className="flex flex-col gap-2 border-t border-border-token pt-4">
        <h3 className="text-[11px] font-medium uppercase tracking-wide text-fg-subtle">
          최근 6개월
        </h3>
        <ul className="flex flex-col gap-1">
          {trend.map((t) => (
            <li key={t.month} className="flex items-center gap-2 text-[12px]">
              <span className="w-16 shrink-0 text-fg-subtle">{t.month}</span>
              <span className="h-2 rounded-full bg-accent" style={{ width: `${(t.minutes / maxTrend) * 100}%` }} />
              <span className="text-fg-muted">{fmt(t.minutes)}</span>
            </li>
          ))}
        </ul>
      </div>

      <div className="flex flex-col gap-2 border-t border-border-token pt-4">
        <h3 className="text-[11px] font-medium uppercase tracking-wide text-fg-subtle">팀별</h3>
        {usage.byTeam.length === 0 ? (
          <p className="text-[13px] text-fg-subtle">이번 달 라이브 사용 기록이 없어요.</p>
        ) : (
          <ul className="flex flex-col gap-1">
            {usage.byTeam.map((t) => (
              <li key={t.teamId} className="flex justify-between text-[13px]">
                <span className="text-fg">{t.teamName}</span>
                <span className="text-fg-muted">{fmt(t.minutes)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
```

> **색 토큰 확인 완료:** `app/globals.css`에 별도의 `danger`/`warning` 토큰은 **없다**. 존재하는 것은 `accent`·`online`·`away`·`busy`·`offline`·`fg`·`fg-muted`·`fg-subtle`·`bg`·`bg-elevated`·`border-token`·`border-strong`이다. 기존 코드는 인라인 오류 문구에 `text-busy`를 쓴다(`app/teams/create-team-form.tsx:77`). 새 토큰을 만들지 말고 위 목록 안에서 해결한다.

- [ ] **Step 6: 테스트 통과 확인**

Run: `npx vitest run app/admin/__tests__/`
Expected: PASS

- [ ] **Step 7: `app/admin/page.tsx` 구현**

```tsx
import { notFound } from "next/navigation";
import { requireSuperAdmin } from "@/lib/auth";
import { currentMonthUsage, monthlyTrend } from "@/lib/live-usage";
import { prisma } from "@/lib/prisma";
import { maxTeams } from "@/lib/settings";
import { MaxTeamsForm } from "./max-teams-form";
import { UsagePanel } from "./usage-panel";

// 관리자 콘솔(ADR-022). (app) 셸 밖의 전역 화면 — 활성 팀 컨텍스트와 무관하다(/teams 로비와 같은 층위).
// CRITICAL: 게이트는 ADMIN_EMAIL 일치. 실패는 403이 아니라 404 — 존재 자체를 숨긴다(R19).
// 읽기는 서버에서(ADR-015). 쓰기는 actions.ts의 Server Action이 권한을 재강제한다.

export default async function AdminPage() {
  try {
    await requireSuperAdmin();
  } catch {
    notFound();
  }

  const [usage, trend, teamCount, limit] = await Promise.all([
    currentMonthUsage(),
    monthlyTrend(6),
    prisma.team.count(),
    maxTeams(),
  ]);

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-2xl flex-col gap-8 p-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-[22px] font-bold tracking-[-0.02em] text-fg">관리자</h1>
        <p className="text-[13px] text-fg-muted">서버 전체 설정과 사용량이에요.</p>
      </header>

      <div className="rounded-lg border border-border-token bg-bg-elevated p-6">
        <UsagePanel usage={usage} trend={trend} />
      </div>

      <div className="flex flex-col gap-4 rounded-lg border border-border-token bg-bg-elevated p-6">
        <h2 className="text-[15px] font-semibold text-fg">설정</h2>
        <MaxTeamsForm current={limit} teamCount={teamCount} />
      </div>
    </main>
  );
}
```

- [ ] **Step 8: 전체 테스트 + 타입체크 + 린트**

Run: `npx vitest run` → 전체 PASS
Run: `npx tsc --noEmit` → 에러 0건
Run: `npm run lint` → 에러 0건

- [ ] **Step 9: 실제 화면 확인**

Run: `npm run dev` 후 브라우저에서 확인한다.
- `de8167@gmail.com`으로 로그인 → `/admin` 접근 → 사용량·설정 렌더 확인
- 상한을 현재 팀 수보다 낮게 저장 시도 → 인라인 `BELOW_CURRENT` 메시지 확인
- 상한을 올려 저장 → `/teams`에서 "새 팀 만들기"가 활성화되는지 확인
- 다른 계정으로 `/admin` 접근 → **404** 확인

- [ ] **Step 10: 커밋**

```bash
git add app/admin
git commit -m "feat(admin): /admin 콘솔 — 라이브 사용량 패널 + 전역 팀 상한 조절"
```

---

### Task 7: 문서 갱신

**Files:**
- Modify: `docs/agent/ADR.md`
- Modify: `docs/agent/RULES.md:45` (R18)
- Modify: `docs/dev/ENV.md`

- [ ] **Step 1: ADR-021 개정 표시**

`docs/agent/ADR.md:193`의 "생성 상한 정책(유지 + 가시화)" 항목에 한 문장을 덧붙인다:

```markdown
> **2026-08-01 개정(ADR-022):** "admin이 env(`MAX_TEAMS`)로만 설정" 조항은 폐기됐다. 상한은 이제 DB(`AppSetting.maxTeams`)에 저장되고 관리자 콘솔(`/admin`)에서 조절한다. env `MAX_TEAMS`는 DB row가 없을 때의 폴백으로만 남는다. **전역 상한이라는 성격(per-user 아님)은 그대로다.**
```

- [ ] **Step 2: ADR-022 추가**

`docs/agent/ADR.md` 끝에 추가한다:

```markdown
## ADR-022. 관리자 콘솔(`/admin`) — 전역 설정 + 라이브 사용량 가시화

- 날짜: 2026-08-01
- 상태: 채택

**맥락.** 전역 팀 상한을 바꾸려면 env 수정 + 재배포가 필요해 운영자가 스스로 처리할 수 없었다. LiveKit 무료 한도(1,000분) 소진 여부도 앱 어디서도 볼 수 없었다.

**결정.**
- 전역 설정은 `AppSetting` **단일 row**(`id="singleton"`)에 저장한다. 우선순위는 **DB > env > 코드 기본**이고, row 부재는 "미설정"이다(자동 생성하지 않는다 — ADR-006/R15 정신).
- 콘솔 접근은 `Member.email == ADMIN_EMAIL`(기본 `de8167@gmail.com`)로만 연다. **`Member.role`을 쓰지 않는다** — role은 DB에서 승격될 수 있다. 실패는 403이 아니라 **404**로 존재를 숨긴다.
- 라이브 사용량은 `LiveSession`/`Participant`에서 **참가자-분을 추정**한다. LiveKit Analytics API는 쓰지 않는다.
- 월 경계는 **KST 1일 00:00**. 월을 걸친 세션은 `joinedAt`이 속한 달에 전액 귀속한다(분할 없음).
- 한도 1,000분은 LiveKit 플랜이 정하므로 **조절 UI를 두지 않는다**. env `LIVE_MINUTES_QUOTA`로 플랜 변경만 대비한다.

**결과.**
- ADR-021의 "상한은 env로만" 조항을 개정한다(위 참조).
- `maxTeams()`가 동기 → 비동기가 되고, 소유가 `lib/teams.ts` → `lib/settings.ts`로 옮겨간다.
- 사용량은 **추정치**다. 재참가가 `Participant` 행을 덮어써 과소집계될 수 있고(`@@unique([liveSessionId, memberId])`), `/leave` 미호출 시 `endedAt` 보정 때문에 과대집계될 수 있다. UI에 "추정치"로 표기한다. 정확한 값이 필요해지면 LiveKit Analytics API 연동을 별도 검토한다.
```

- [ ] **Step 3: R18 갱신**

`docs/agent/RULES.md:45`에서 `전역 팀 상한 MAX_TEAMS(기본 2).` 부분을 아래로 바꾼다:

```markdown
전역 팀 상한은 `AppSetting.maxTeams` > env `MAX_TEAMS` > 기본 2 순으로 정해지며 `/admin`에서 조절한다(ADR-022).
```

- [ ] **Step 4: ENV.md에 세 항목 추가**

`docs/dev/ENV.md`의 표에 행을 추가한다:

```markdown
| `MAX_TEAMS` | 전역 팀 생성 상한 **폴백** | 기본 `2`. `AppSetting.maxTeams`가 있으면 그쪽이 이긴다(ADR-022) |
| `ADMIN_EMAIL` | 관리자 콘솔(`/admin`) 접근 허용 이메일 | 기본 `de8167@gmail.com`. `Member.email`과 일치해야 통과 |
| `LIVE_MINUTES_QUOTA` | 월 라이브 한도(분) 표시 기준 | 기본 `1000` (LiveKit 플랜 값). 조절 UI 없음 |
```

- [ ] **Step 5: 커밋**

```bash
git add docs/agent/ADR.md docs/agent/RULES.md docs/dev/ENV.md
git commit -m "docs(admin): ADR-022 추가 + ADR-021 상한 정책 개정 + ENV 3항목 문서화"
```

---

## 배포 메모

- Vercel 프로덕션에 `MAX_TEAMS=3`은 **이미 설정돼 있다**(2026-08-01). ADR-022 적용 후에도 DB row가 없으면 이 값이 폴백으로 쓰이므로 지울 필요 없다.
- `ADMIN_EMAIL`은 기본값이 `de8167@gmail.com`이라 **운영에 따로 넣지 않아도 동작한다**. 바꿀 때만 추가한다.
- 배포 시 마이그레이션(`AppSetting` 테이블)이 프로덕션 DB에 적용돼야 한다.
- env만 바꿀 때는 `vercel redeploy <직전 prod URL>`로 기존 소스를 재빌드하는 편이 안전하다(로컬 트리에 무관한 WIP이 있을 때 특히).
