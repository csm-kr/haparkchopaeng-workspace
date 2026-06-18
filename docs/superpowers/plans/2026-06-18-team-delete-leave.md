# 팀 삭제·탈퇴 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 전역 관리자/owner가 팀을 삭제하고, 비-owner 멤버가 스스로 팀을 탈퇴할 수 있게 한다(추방은 이미 존재 — 회귀만).

**Architecture:** 쓰기는 Server Action(`deleteTeamAction`)+도메인(`deleteTeam`)으로(ADR-015/R32), 권한은 액션 진입부에서 앱레벨로 강제(R19). 삭제 UI는 `/teams` 허브의 신규 클라 섬에, 탈퇴 UI는 기존 `team-manager`에 버튼만 추가(서버 라우트는 이미 본인 탈퇴 허용). 팀-스코프 데이터는 `$transaction` cascade로 정리.

**Tech Stack:** Next.js 15(App Router, RSC + Server Actions), React 19, TypeScript strict, Prisma 6(Postgres), Vitest 2 + Testing Library, Tailwind.

## Global Constraints

- 코드 외 모든 주석·설명·UI 카피는 한국어. 역할 표기는 영어 그대로(owner/admin/member) — 한국어(팀장/관리자/팀원) 번역 금지.
- 권한은 RLS 없이 앱레벨에서 강제(R19). 식별자·역할은 세션에서 취하고 클라 입력을 신뢰하지 않는다(R3).
- 파괴적 액션은 확인 다이얼로그 필수(R27).
- 도메인/액션 실패는 토스트가 아니라 판별 유니온 → 인라인 메시지(R30).
- owner는 탈퇴·강등·추방 불가(팀당 owner ≥ 1, ADR-018). owner가 빠지려면 팀 삭제.
- 테스트 먼저(TDD). 테스트 단일 실행: `npx vitest run <path>`. 전체: `npm run test`.
- 커밋은 conventional commits. 각 커밋 메시지 끝에 아래 두 줄 footer:
  ```
  Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01Lhn6DUq3QbaTfqHQu68BUb
  ```
- 작업 전 동시 실행 중인 python/harness(execute.py) 프로세스가 없는지 확인하고, 내 변경 파일만 `git add` 한다(클로버 방지).

---

### Task 1: `deleteTeam(teamId)` 도메인 (cascade)

**Files:**
- Modify: `lib/teams.ts` (파일 끝에 함수 추가)
- Test: `lib/__tests__/delete-team.test.ts` (신규)

**Interfaces:**
- Consumes: `prisma`(`@/lib/prisma`) — `$transaction`, 각 모델 `deleteMany`, `team.delete`.
- Produces: `export async function deleteTeam(teamId: string): Promise<void>`

> 참고: 실제 자식 cascade(`Analysis`/`Figure`/`SectionNote`/`PresentationAsset`/`PresentationVersion`/`Comment`/`Reaction`/`ScheduleWeek`/`Participant`/`Membership`/`Invite`)는 스키마의 DB FK(`onDelete: Cascade`)가 처리한다. 이 단위 테스트는 `deleteTeam`이 **FK 없는 팀-스코프 테이블을 올바른 순서로 트랜잭션 안에서 삭제**하는지를 검증한다(실제 FK cascade는 DB 책임이라 mock 단위로 검증하지 않는다).

- [ ] **Step 1: 실패 테스트 작성** — `lib/__tests__/delete-team.test.ts`

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

// deleteTeam 단위 테스트 — prisma 델리게이트 호출을 기록해 "어떤 테이블을 어떤 순서로" 지우는지 검증.
// 실제 자식 cascade는 DB FK(onDelete: Cascade) 책임 — 여기선 FK 없는 팀-스코프 테이블 삭제 순서·트랜잭션만 본다.
const { calls } = vi.hoisted(() => ({ calls: [] as string[] }));

vi.mock("@/lib/prisma", () => {
  const rec = (model: string) => ({
    deleteMany: vi.fn(async ({ where }: { where: { teamId: string } }) => {
      calls.push(`${model}.deleteMany:${where.teamId}`);
      return { count: 0 };
    }),
  });
  const team = {
    delete: vi.fn(async ({ where }: { where: { id: string } }) => {
      calls.push(`team.delete:${where.id}`);
      return {};
    }),
  };
  const models = {
    memberLedger: rec("memberLedger"),
    fineConfig: rec("fineConfig"),
    paper: rec("paper"),
    presentation: rec("presentation"),
    scheduleMonth: rec("scheduleMonth"),
    liveSession: rec("liveSession"),
    teamInviteAcceptance: rec("teamInviteAcceptance"),
    team,
  };
  return {
    prisma: {
      ...models,
      $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(models)),
    },
  };
});

import { deleteTeam } from "@/lib/teams";

beforeEach(() => {
  calls.length = 0;
});

describe("deleteTeam()", () => {
  it("팀-스코프 테이블을 정해진 순서로 지우고 마지막에 팀을 지운다", async () => {
    await deleteTeam("t1");
    expect(calls).toEqual([
      "memberLedger.deleteMany:t1",
      "fineConfig.deleteMany:t1",
      "paper.deleteMany:t1",
      "presentation.deleteMany:t1",
      "scheduleMonth.deleteMany:t1",
      "liveSession.deleteMany:t1",
      "teamInviteAcceptance.deleteMany:t1",
      "team.delete:t1",
    ]);
  });

  it("memberLedger를 fineConfig보다 먼저 지운다(FK restrict 회피)", async () => {
    await deleteTeam("t1");
    expect(calls.indexOf("memberLedger.deleteMany:t1")).toBeLessThan(
      calls.indexOf("fineConfig.deleteMany:t1"),
    );
  });

  it("모든 삭제를 단일 $transaction 안에서 수행한다", async () => {
    const { prisma } = await import("@/lib/prisma");
    await deleteTeam("t1");
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run lib/__tests__/delete-team.test.ts`
Expected: FAIL — `deleteTeam is not a function` (또는 import 오류).

- [ ] **Step 3: 최소 구현** — `lib/teams.ts` 파일 끝에 추가

```ts
/**
 * 팀과 그 팀에 속한 모든 데이터를 삭제한다(원자적). Membership·Invite는 Team FK(onDelete: Cascade)로,
 * Paper/Presentation/ScheduleMonth/LiveSession의 자식들은 각자의 FK cascade로 자동 정리된다.
 * teamId만 가진(FK 없는) 테이블은 여기서 수동 삭제한다.
 * CRITICAL: MemberLedger는 FineConfig의 required 관계 자식(기본 Restrict)이라 FineConfig보다 먼저 지운다.
 * Out: Supabase 스토리지 파일·Job(payload.paperId)은 지우지 않는다(DB-only, 합의된 범위).
 */
export async function deleteTeam(teamId: string): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.memberLedger.deleteMany({ where: { teamId } });
    await tx.fineConfig.deleteMany({ where: { teamId } });
    await tx.paper.deleteMany({ where: { teamId } }); // → Analysis·Figure·SectionNote cascade
    await tx.presentation.deleteMany({ where: { teamId } }); // → Asset·Version·Comment→Reaction cascade
    await tx.scheduleMonth.deleteMany({ where: { teamId } }); // → ScheduleWeek cascade
    await tx.liveSession.deleteMany({ where: { teamId } }); // → Participant cascade
    await tx.teamInviteAcceptance.deleteMany({ where: { teamId } }); // 관계 없음 — 수동
    await tx.team.delete({ where: { id: teamId } }); // → Membership·Invite cascade
  });
}
```

> `$transaction`의 콜백 인자 타입은 `Prisma.TransactionClient`다. `lib/teams.ts`는 이미 `import { prisma } from "@/lib/prisma";`를 갖고 있으니 추가 import 불필요. `tx`는 추론되며, 위 모델 델리게이트는 전부 prisma client에 존재한다.

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run lib/__tests__/delete-team.test.ts`
Expected: PASS (3개).

- [ ] **Step 5: 커밋**

```bash
git add lib/teams.ts lib/__tests__/delete-team.test.ts
git commit -m "feat(teams): deleteTeam 도메인 — 팀 스코프 데이터 트랜잭션 cascade 삭제

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Lhn6DUq3QbaTfqHQu68BUb"
```

---

### Task 2: `deleteTeamAction(slug)` Server Action (권한)

**Files:**
- Modify: `app/teams/actions.ts` (파일 끝에 타입+액션 추가, import 보강)
- Test: `app/teams/__tests__/delete-team-action.test.ts` (신규)

**Interfaces:**
- Consumes: `requireAuth`(`@/lib/auth`), `prisma`(`@/lib/prisma`), `isTeamOwner`·`deleteTeam`(`@/lib/teams`), `revalidatePath`(`next/cache`).
- Produces:
  - `export type DeleteTeamResult = { ok: true } | { ok: false; code: string; message: string };`
  - `export async function deleteTeamAction(slug: string): Promise<DeleteTeamResult>`

- [ ] **Step 1: 실패 테스트 작성** — `app/teams/__tests__/delete-team-action.test.ts`

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

// deleteTeamAction 단위 테스트 — auth/prisma/teams/cache 모킹.
// 검증: 미인증 거부 · 없는 slug 404 · 비관리자&비owner FORBIDDEN · owner ok · 전역 관리자 ok.
const { requireAuthMock } = vi.hoisted(() => ({ requireAuthMock: vi.fn() }));
vi.mock("@/lib/auth", () => ({ requireAuth: requireAuthMock }));

const { findUniqueMock } = vi.hoisted(() => ({ findUniqueMock: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: { team: { findUnique: findUniqueMock } } }));

const { isTeamOwnerMock, deleteTeamMock } = vi.hoisted(() => ({
  isTeamOwnerMock: vi.fn(),
  deleteTeamMock: vi.fn(),
}));
vi.mock("@/lib/teams", () => ({ isTeamOwner: isTeamOwnerMock, deleteTeam: deleteTeamMock }));

const { revalidatePathMock } = vi.hoisted(() => ({ revalidatePathMock: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: revalidatePathMock }));

import { HttpError } from "@/lib/http";
const { deleteTeamAction } = await import("@/app/teams/actions");

beforeEach(() => {
  vi.clearAllMocks();
  findUniqueMock.mockResolvedValue({ id: "t1", slug: "crew", name: "Crew" });
  isTeamOwnerMock.mockResolvedValue(false);
});

describe("deleteTeamAction", () => {
  it("미인증이면 삭제하지 않고 UNAUTHORIZED", async () => {
    requireAuthMock.mockRejectedValue(new HttpError(401, "UNAUTHORIZED", "x"));
    const result = await deleteTeamAction("crew");
    expect(result).toEqual({ ok: false, code: "UNAUTHORIZED", message: "로그인이 필요해요." });
    expect(deleteTeamMock).not.toHaveBeenCalled();
  });

  it("없는 slug면 NOT_FOUND", async () => {
    requireAuthMock.mockResolvedValue({ memberId: "jo", role: "멤버" });
    findUniqueMock.mockResolvedValue(null);
    const result = await deleteTeamAction("ghost");
    expect(result).toEqual({ ok: false, code: "NOT_FOUND", message: "팀을 찾을 수 없어요." });
    expect(deleteTeamMock).not.toHaveBeenCalled();
  });

  it("비관리자&비owner면 FORBIDDEN(삭제 안 함)", async () => {
    requireAuthMock.mockResolvedValue({ memberId: "jo", role: "멤버" });
    isTeamOwnerMock.mockResolvedValue(false);
    const result = await deleteTeamAction("crew");
    expect(result.ok).toBe(false);
    expect((result as { code: string }).code).toBe("FORBIDDEN");
    expect(deleteTeamMock).not.toHaveBeenCalled();
  });

  it("팀 owner(비관리자)면 삭제하고 ok", async () => {
    requireAuthMock.mockResolvedValue({ memberId: "ha", role: "멤버" });
    isTeamOwnerMock.mockResolvedValue(true);
    const result = await deleteTeamAction("crew");
    expect(result).toEqual({ ok: true });
    expect(deleteTeamMock).toHaveBeenCalledWith("t1");
    expect(revalidatePathMock).toHaveBeenCalledWith("/teams");
  });

  it("전역 관리자면 owner가 아니어도 삭제하고 ok", async () => {
    requireAuthMock.mockResolvedValue({ memberId: "jo", role: "관리자" });
    isTeamOwnerMock.mockResolvedValue(false);
    const result = await deleteTeamAction("crew");
    expect(result).toEqual({ ok: true });
    expect(deleteTeamMock).toHaveBeenCalledWith("t1");
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run app/teams/__tests__/delete-team-action.test.ts`
Expected: FAIL — `deleteTeamAction` export 없음.

- [ ] **Step 3: 최소 구현** — `app/teams/actions.ts`

import 보강(파일 상단, 기존 import 옆):

```ts
import { revalidatePath } from "next/cache";
import { requireAuth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { createTeam, deleteTeam, isTeamOwner } from "@/lib/teams";
```

> 기존 파일은 `import { createTeam } from "@/lib/teams";`와 `import { requireAuth } from "@/lib/auth";`를 이미 갖고 있다. 위처럼 `deleteTeam, isTeamOwner`를 합치고, `prisma`·`revalidatePath` import를 추가한다. `z`·`HttpError` 등 기존 import는 그대로 둔다.

파일 끝에 추가:

```ts
// 팀 삭제 Server Action (쓰기 = Server Action, ADR-015/R32). 팀 허브(ADR-021)가 소유한다.
// CRITICAL: 권한은 진입부에서 강제(R19) — 전역 관리자(role==="관리자")는 아무 팀이나, 그 외엔 그 팀 owner만.
// 식별자·역할은 세션에서(R3). 파괴는 deleteTeam이 트랜잭션 cascade로 수행. 결과는 판별 유니온(R30).
export type DeleteTeamResult = { ok: true } | { ok: false; code: string; message: string };

export async function deleteTeamAction(slug: string): Promise<DeleteTeamResult> {
  let session;
  try {
    session = await requireAuth();
  } catch {
    return { ok: false, code: "UNAUTHORIZED", message: "로그인이 필요해요." };
  }

  const team = await prisma.team.findUnique({ where: { slug } });
  if (!team) return { ok: false, code: "NOT_FOUND", message: "팀을 찾을 수 없어요." };

  const allowed = session.role === "관리자" || (await isTeamOwner(team.id, session.memberId));
  if (!allowed) return { ok: false, code: "FORBIDDEN", message: "팀을 삭제할 권한이 없어요." };

  await deleteTeam(team.id);
  revalidatePath("/teams");
  return { ok: true };
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run app/teams/__tests__/delete-team-action.test.ts`
Expected: PASS (5개).

- [ ] **Step 5: 커밋**

```bash
git add app/teams/actions.ts app/teams/__tests__/delete-team-action.test.ts
git commit -m "feat(teams): deleteTeamAction — 전역 관리자/owner 팀 삭제 권한 강제

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Lhn6DUq3QbaTfqHQu68BUb"
```

---

### Task 3: `/teams` 허브 삭제 섹션

**Files:**
- Create: `app/teams/delete-team-section.tsx`
- Modify: `app/teams/page.tsx` (삭제 가능 팀 계산 + 섹션 렌더)
- Test: `app/teams/__tests__/delete-team-section.test.tsx` (신규)

**Interfaces:**
- Consumes: `deleteTeamAction`(`./actions`, Task 2), `useRouter`(`next/navigation`), `Button`·`Card`·`Input`(`@/components/ui`).
- Produces: `export function DeleteTeamSection(props: { teams: { slug: string; name: string }[] }): JSX.Element | null`

- [ ] **Step 1: 실패 테스트 작성** — `app/teams/__tests__/delete-team-section.test.tsx`

```tsx
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { DeleteTeamSection } from "../delete-team-section";

// 팀 삭제 섹션 — 삭제 가능 팀 나열 + 이름 타이핑 확인(R27) → deleteTeamAction 호출.
// 가시화는 서버가 계산해 props로 준다(관리자=전체 / owner=내 팀). 여기선 확인 게이트·액션 호출을 본다.
const { refreshMock } = vi.hoisted(() => ({ refreshMock: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: refreshMock }) }));

const { deleteTeamActionMock } = vi.hoisted(() => ({ deleteTeamActionMock: vi.fn() }));
vi.mock("../actions", () => ({ deleteTeamAction: deleteTeamActionMock }));

const TEAMS = [
  { slug: "alpha", name: "알파" },
  { slug: "beta", name: "베타" },
];

beforeEach(() => {
  vi.clearAllMocks();
  deleteTeamActionMock.mockResolvedValue({ ok: true });
});

describe("DeleteTeamSection", () => {
  it("팀이 없으면 아무것도 렌더하지 않는다", () => {
    const { container } = render(<DeleteTeamSection teams={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("삭제 가능 팀을 행으로 + 각 행에 삭제 버튼", () => {
    render(<DeleteTeamSection teams={TEAMS} />);
    expect(screen.getByRole("button", { name: "알파 삭제" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "베타 삭제" })).toBeInTheDocument();
  });

  it("이름을 정확히 입력해야 확정 버튼이 활성화되고 액션을 호출한다(R27)", async () => {
    render(<DeleteTeamSection teams={TEAMS} />);
    fireEvent.click(screen.getByRole("button", { name: "알파 삭제" }));

    const dialog = screen.getByRole("dialog", { name: "팀 삭제 확인" });
    const confirmBtn = within(dialog).getByRole("button", { name: "영구 삭제" });
    expect(confirmBtn).toBeDisabled(); // 입력 전엔 비활성
    expect(deleteTeamActionMock).not.toHaveBeenCalled();

    // 오타 — 여전히 비활성
    fireEvent.change(within(dialog).getByLabelText("삭제 확인 팀 이름"), {
      target: { value: "알" },
    });
    expect(confirmBtn).toBeDisabled();

    // 정확히 입력 — 활성화 후 클릭
    fireEvent.change(within(dialog).getByLabelText("삭제 확인 팀 이름"), {
      target: { value: "알파" },
    });
    expect(confirmBtn).toBeEnabled();
    await act(async () => {
      fireEvent.click(confirmBtn);
    });
    expect(deleteTeamActionMock).toHaveBeenCalledWith("alpha");
    expect(refreshMock).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run app/teams/__tests__/delete-team-section.test.tsx`
Expected: FAIL — `../delete-team-section` 모듈 없음.

- [ ] **Step 3: 컴포넌트 구현** — `app/teams/delete-team-section.tsx`

```tsx
"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Button, Card, Input } from "@/components/ui";
import { deleteTeamAction } from "./actions";

// 팀 삭제 섹션 — 인터랙티브 섬(ADR-015). 쓰기는 Server Action(deleteTeamAction).
// CRITICAL: 표시되는 팀 목록은 서버가 권한으로 계산해 props로 준다(관리자=전체/owner=내 팀). UI는 보조, 서버가 최종(R19).
// CRITICAL: 파괴적이라 팀 이름 타이핑 확인을 거친다(R27) — 입장 picker와 분리해 오삭제를 막는다.

export interface DeleteTeamSectionProps {
  teams: { slug: string; name: string }[];
}

export function DeleteTeamSection({ teams }: DeleteTeamSectionProps) {
  const router = useRouter();
  const [target, setTarget] = React.useState<{ slug: string; name: string } | null>(null);
  const [confirmText, setConfirmText] = React.useState("");
  const [deleting, setDeleting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  if (teams.length === 0) return null;

  function openDialog(team: { slug: string; name: string }) {
    setTarget(team);
    setConfirmText("");
    setError(null);
  }

  async function confirmDelete() {
    if (!target || confirmText !== target.name) return;
    setDeleting(true);
    setError(null);
    const result = await deleteTeamAction(target.slug);
    if (!result.ok) {
      setError(result.message);
      setDeleting(false);
      return;
    }
    setDeleting(false);
    setTarget(null);
    router.refresh();
  }

  return (
    <section className="flex flex-col gap-2 border-t border-border-token pt-5">
      <h2 className="text-[11px] font-medium uppercase tracking-wide text-fg-subtle">팀 삭제</h2>
      <ul aria-label="삭제 가능한 팀" className="flex flex-col gap-2">
        {teams.map((t) => (
          <li
            key={t.slug}
            className="flex items-center justify-between gap-3 rounded-md border border-border-token px-3.5 py-3"
          >
            <span className="truncate text-[14px] font-medium text-fg">{t.name}</span>
            <Button
              variant="danger"
              size="sm"
              onClick={() => openDialog(t)}
              aria-label={`${t.name} 삭제`}
            >
              삭제
            </Button>
          </li>
        ))}
      </ul>

      {target && (
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-[color-mix(in_oklch,var(--fg)_28%,transparent)] p-4"
          onKeyDown={(e) => {
            if (e.key === "Escape") setTarget(null);
          }}
        >
          <Card
            role="dialog"
            aria-modal="true"
            aria-label="팀 삭제 확인"
            className="flex w-full max-w-sm flex-col gap-3 p-5"
          >
            <p className="text-[15px] font-semibold text-fg">{target.name} 팀을 삭제할까요?</p>
            <p className="text-[13px] text-fg-muted">
              이 팀의 논문·발표·일정·벌금·라이브 기록이 모두 영구 삭제돼요. 되돌릴 수 없어요.
            </p>
            <label className="flex flex-col gap-1 text-[12px] text-fg-subtle">
              확인을 위해 팀 이름 <b className="text-fg">{target.name}</b> 을(를) 입력하세요
              <Input
                aria-label="삭제 확인 팀 이름"
                value={confirmText}
                onChange={(e) => setConfirmText(e.target.value)}
              />
            </label>
            {error && (
              <p role="alert" className="text-[12px] text-busy">
                {error}
              </p>
            )}
            <div className="mt-1 flex items-center justify-end gap-2">
              <Button variant="secondary" size="sm" onClick={() => setTarget(null)}>
                취소
              </Button>
              <Button
                variant="danger"
                size="sm"
                onClick={confirmDelete}
                disabled={deleting || confirmText !== target.name}
              >
                {deleting ? "삭제 중…" : "영구 삭제"}
              </Button>
            </div>
          </Card>
        </div>
      )}
    </section>
  );
}
```

- [ ] **Step 4: 컴포넌트 테스트 통과 확인**

Run: `npx vitest run app/teams/__tests__/delete-team-section.test.tsx`
Expected: PASS (3개).

- [ ] **Step 5: `page.tsx` 배선** — `app/teams/page.tsx` 전체를 아래로 교체

```tsx
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canCreateTeam, listMemberships } from "@/lib/teams";
import { TeamPicker } from "./team-picker";
import { CreateTeamForm } from "./create-team-form";
import { DeleteTeamSection } from "./delete-team-section";

// 진입 팀 허브(로비) — 로그인 후 착지 화면(ADR-021, SCREENS §teams).
// (app) 셸 밖의 독립 로비 — 사이드바·TeamSwitcher 없음. 데이터 읽기는 서버에서(ADR-015).
// 진입 경로는 둘뿐: 팀 선택(활성 팀 전환) · 팀 만들기/초대 수락(R18). 공개 가입 없음.
// 로그인 후 기본 착지(ADR-021): auth/callback·app/page가 next ?? "/teams"로 여기로 보낸다.
// 삭제 섹션(R19 보조 가시화): 전역 관리자=전체 팀 / 그 외=내가 owner인 팀. 서버 액션이 최종 강제.

export default async function TeamHubPage() {
  const session = await getSession();
  if (!session) redirect("/");

  // 읽기는 서버에서(ADR-015) — 내 팀 목록(최근 합류 순)과 전역 생성 가능 여부.
  const [teams, canCreate] = await Promise.all([
    listMemberships(session.memberId),
    canCreateTeam(),
  ]);

  // 삭제 가능한 팀: 전역 관리자는 전체, 그 외엔 내가 owner인 팀만(서버 액션이 재강제, R19).
  const deletableTeams =
    session.role === "관리자"
      ? (await prisma.team.findMany({ orderBy: { createdAt: "asc" } })).map((t) => ({
          slug: t.slug,
          name: t.name,
        }))
      : teams.filter((t) => t.role === "owner").map((t) => ({ slug: t.slug, name: t.name }));

  return (
    <main className="flex min-h-screen items-center justify-center overflow-y-auto p-6">
      <div className="flex w-full max-w-md flex-col gap-6 rounded-lg border border-border-token bg-bg-elevated p-6">
        <div className="flex flex-col gap-1">
          <h1 className="text-[22px] font-bold tracking-[-0.02em] text-fg">팀 선택</h1>
          <p className="text-[13px] text-fg-muted">
            {teams.length > 0
              ? "들어갈 팀을 고르거나, 새 팀을 만들어 시작하세요."
              : "새 팀을 만들어 시작하거나, 받은 초대 링크로 합류하세요."}
          </p>
        </div>

        {teams.length > 0 && (
          <section className="flex flex-col gap-2">
            <h2 className="text-[11px] font-medium uppercase tracking-wide text-fg-subtle">
              내 팀
            </h2>
            <TeamPicker teams={teams} />
          </section>
        )}

        <section className="flex flex-col gap-3 border-t border-border-token pt-5">
          <h2 className="text-[11px] font-medium uppercase tracking-wide text-fg-subtle">
            새 팀 만들기
          </h2>
          <CreateTeamForm canCreate={canCreate} />
        </section>

        <div className="border-t border-border-token pt-4 text-[13px] text-fg-subtle">
          초대 링크를 받았다면 그 주소로 들어가면 합류할 수 있어요.
        </div>

        <DeleteTeamSection teams={deletableTeams} />
      </div>
    </main>
  );
}
```

- [ ] **Step 6: 타입/린트 확인 + 전체 teams 테스트**

Run: `npx tsc --noEmit`
Expected: 에러 없음.
Run: `npx vitest run app/teams lib/__tests__/delete-team.test.ts`
Expected: PASS (기존 team-picker/create-team-form 포함 전부 그린).

- [ ] **Step 7: 커밋**

```bash
git add app/teams/delete-team-section.tsx app/teams/page.tsx app/teams/__tests__/delete-team-section.test.tsx
git commit -m "feat(teams): /teams 허브에 팀 삭제 섹션(관리자=전체/owner=내 팀, 이름 확인)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Lhn6DUq3QbaTfqHQu68BUb"
```

---

### Task 4: `team-manager` 팀 나가기(탈퇴)

**Files:**
- Modify: `components/team/team-manager.tsx` (useRouter import + 본인 행 버튼 + 확인 다이얼로그)
- Test: `components/team/__tests__/team.test.tsx` (next/navigation 모킹 추가 + 탈퇴 테스트 3개)

**Interfaces:**
- Consumes: 기존 `callJson`(team-manager 내부), `useRouter`(`next/navigation`), 기존 `DELETE /api/teams/:slug/members/:memberId`(이미 본인 탈퇴 허용).
- Produces: UI만 — 새 export 없음.

> CRITICAL: team-manager가 새로 `useRouter`를 호출하므로, 기존 `team.test.tsx`가 `next/navigation`을 모킹하지 않으면 **모든 기존 테스트가 렌더 단계에서 깨진다**. 그래서 Step 1에서 모킹부터 추가한다.

- [ ] **Step 1: `team.test.tsx`에 router 모킹 + 탈퇴 테스트 추가**

파일 상단(기존 import 아래, `const members` 위)에 추가:

```tsx
const { pushMock } = vi.hoisted(() => ({ pushMock: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: pushMock }) }));
```

기존 `beforeEach`를 아래로 교체(pushMock 정리 추가):

```tsx
beforeEach(() => {
  vi.restoreAllMocks();
  pushMock.mockClear();
});
```

`describe("TeamManager", ...)` 블록 안 끝에 테스트 3개 추가:

```tsx
it("비-owner 본인 행에는 '팀 나가기' 버튼이 있다", () => {
  renderTeam({ currentUserId: "jo", currentUserRole: "member" });
  expect(screen.getByRole("button", { name: "팀 나가기" })).toBeInTheDocument();
});

it("owner 본인 행에는 '팀 나가기' 버튼이 없다(owner는 탈퇴 불가)", () => {
  renderTeam({ currentUserId: "ha", currentUserRole: "owner" });
  expect(screen.queryByRole("button", { name: "팀 나가기" })).not.toBeInTheDocument();
});

it("팀 나가기는 확인을 거쳐 self DELETE 멤버 API를 호출하고 /teams로 이동한다(R27)", async () => {
  const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonRes({ memberId: "jo" }));
  renderTeam({ currentUserId: "jo", currentUserRole: "member" });

  fireEvent.click(screen.getByRole("button", { name: "팀 나가기" }));
  const dialog = screen.getByRole("dialog", { name: "팀 나가기 확인" });
  expect(fetchMock).not.toHaveBeenCalled(); // 확인 전엔 호출 안 함

  await act(async () => {
    fireEvent.click(within(dialog).getByRole("button", { name: "나가기" }));
  });
  expect(fetchMock).toHaveBeenCalledWith(
    "/api/teams/crew/members/jo",
    expect.objectContaining({ method: "DELETE" }),
  );
  expect(pushMock).toHaveBeenCalledWith("/teams");
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run components/team/__tests__/team.test.tsx`
Expected: FAIL — `팀 나가기` 버튼 없음(새 테스트 3개 실패). 기존 테스트는 router 모킹 덕에 통과.

- [ ] **Step 3: `team-manager.tsx` 구현**

(3-1) import에 `useRouter` 추가 — 파일 상단:

```tsx
import { useRouter } from "next/navigation";
```

(3-2) 컴포넌트 본문 상단(`const [members, setMembers] = ...` 근처, 기존 state 옆)에 추가:

```tsx
  const router = useRouter();
  const canLeave = currentUserRole !== "owner"; // owner는 탈퇴 불가(팀당 owner ≥ 1)
  const [confirmLeave, setConfirmLeave] = React.useState(false);
  const [leaving, setLeaving] = React.useState(false);
```

(3-3) 탈퇴 핸들러 추가 — 기존 `confirmRemove` 함수 바로 아래:

```tsx
  // 본인 탈퇴(비-owner) — 기존 멤버 DELETE 라우트가 isSelf를 허용(서버가 최종, R19). 성공 시 허브로.
  async function confirmLeaveTeam() {
    setLeaving(true);
    setActionError(null);
    try {
      await callJson(`/api/teams/${teamSlug}/members/${currentUserId}`, { method: "DELETE" });
      router.push("/teams");
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "팀을 나가지 못했어요.");
      setLeaving(false);
      setConfirmLeave(false);
    }
  }
```

(3-4) 본인 행에 버튼 추가 — 멤버 `<li>` 안, `{hasMenu(m, isSelf) && ( ... )}` 블록 **바로 아래**에 추가:

```tsx
                {isSelf && canLeave && (
                  <Button variant="ghost" size="sm" onClick={() => setConfirmLeave(true)}>
                    팀 나가기
                  </Button>
                )}
```

(3-5) 탈퇴 확인 다이얼로그 추가 — 기존 내보내기 다이얼로그(`{removeTarget && ( ... )}`) **바로 아래**에 추가:

```tsx
      {/* 팀 나가기 확인 — 파괴적은 아니나 접근 상실이라 확인(R27). */}
      {confirmLeave && (
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-[color-mix(in_oklch,var(--fg)_28%,transparent)] p-4"
          onKeyDown={(e) => {
            if (e.key === "Escape") setConfirmLeave(false);
          }}
        >
          <Card
            role="dialog"
            aria-modal="true"
            aria-label="팀 나가기 확인"
            className="flex w-full max-w-sm flex-col gap-3 p-5"
          >
            <p className="text-[15px] font-semibold text-fg">이 팀을 나갈까요?</p>
            <p className="text-[13px] text-fg-muted">
              나가면 더 이상 이 팀에 접근할 수 없어요. 다시 합류하려면 초대를 받아야 해요.
            </p>
            <div className="mt-1 flex items-center justify-end gap-2">
              <Button variant="secondary" size="sm" onClick={() => setConfirmLeave(false)}>
                취소
              </Button>
              <Button variant="danger" size="sm" onClick={confirmLeaveTeam} disabled={leaving}>
                {leaving ? "나가는 중…" : "나가기"}
              </Button>
            </div>
          </Card>
        </div>
      )}
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run components/team/__tests__/team.test.tsx`
Expected: PASS (기존 + 신규 3개 전부).

- [ ] **Step 5: 전체 검증**

Run: `npx tsc --noEmit`
Expected: 에러 없음.
Run: `npm run test`
Expected: 전체 스위트 그린.
Run: `npm run lint`
Expected: 경고/에러 없음.

- [ ] **Step 6: 커밋**

```bash
git add components/team/team-manager.tsx components/team/__tests__/team.test.tsx
git commit -m "feat(teams): 팀 관리에 '팀 나가기'(비-owner 본인 탈퇴) 추가

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Lhn6DUq3QbaTfqHQu68BUb"
```

---

## Self-Review

**Spec coverage:**
- 팀 삭제 도메인 cascade → Task 1 ✅
- 권한(전역 관리자/owner) → Task 2 ✅
- `/teams` 허브 삭제 UI(관리자=전체/owner=내 팀, 이름 확인) → Task 3 ✅
- 팀 탈퇴 UI(비-owner 본인) → Task 4 ✅
- 추방(이미 존재) → Task 4의 기존 회귀 테스트가 그대로 통과(변경 없음) ✅
- Out(스토리지·Job·owner 양도·승격 UI·멤버 라우트 무변경) → 어떤 Task도 건드리지 않음 ✅

**Placeholder scan:** TBD/TODO/"적절히 처리" 없음. 모든 step에 실제 코드·명령·기대 출력 포함 ✅

**Type consistency:**
- `deleteTeam(teamId: string): Promise<void>` — Task 1 정의, Task 2에서 `deleteTeam(team.id)` 호출(string) ✅
- `DeleteTeamResult` 판별 유니온 — Task 2 정의, Task 3에서 `result.ok`/`result.message` 사용 ✅
- `deleteTeamAction(slug: string)` — Task 2 정의, Task 3에서 `deleteTeamAction(target.slug)` 호출 ✅
- `DeleteTeamSection({ teams: {slug,name}[] })` — Task 3 정의, page.tsx가 `deletableTeams`(동형) 전달 ✅
- 탈퇴는 기존 `callJson`·기존 라우트 재사용 — 새 시그니처 없음 ✅

## 실행 순서 / 의존성

Task 1 → 2 → 3 → 4 순서(2는 1의 `deleteTeam`, 3은 2의 액션에 의존). 4는 독립(기존 라우트 재사용)이라 언제든 가능하나 마지막에 배치.
