import { beforeEach, describe, expect, it, vi } from "vitest";

// 댓글/반응 Server Action 팀 스코핑(ADR-020/R37) — 부모(Presentation/Comment)가 활성 팀 것일 때만.
// CRITICAL: 교차 팀 부모면 404(R19). authorId·memberId는 세션에서(R3) — 변하지 않는다.

const { requireAuthMock } = vi.hoisted(() => ({ requireAuthMock: vi.fn() }));
vi.mock("@/lib/auth", () => ({ requireAuth: requireAuthMock }));

const { getActiveTeamMock } = vi.hoisted(() => ({ getActiveTeamMock: vi.fn() }));
vi.mock("@/lib/active-team", () => ({ getActiveTeam: getActiveTeamMock }));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    presentation: { findFirst: vi.fn() },
    comment: { findFirst: vi.fn(), create: vi.fn() },
    reaction: { findUnique: vi.fn(), create: vi.fn(), delete: vi.fn(), findMany: vi.fn() },
    member: { findUnique: vi.fn(), findMany: vi.fn() },
  },
}));
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));

const { addComment, toggleReaction } = await import(
  "@/app/(app)/presentations/[id]/actions"
);

beforeEach(() => {
  vi.clearAllMocks();
  requireAuthMock.mockResolvedValue({ memberId: "jo", role: "멤버" });
  getActiveTeamMock.mockResolvedValue({ id: "tA", slug: "alpha", role: "member" });
  prismaMock.member.findUnique.mockResolvedValue({
    id: "jo",
    name: "조성민",
    handle: "@jo",
    initial: "조",
    color: "var(--m-jo)",
  });
  prismaMock.member.findMany.mockResolvedValue([]);
  prismaMock.reaction.findMany.mockResolvedValue([]);
});

describe("addComment — 부모 발표 자료 팀 스코핑", () => {
  it("활성 팀의 자료면 댓글을 만들고 authorId를 세션에서 주입한다", async () => {
    prismaMock.presentation.findFirst.mockImplementation(
      async ({ where }: { where: { id: string; teamId: string } }) =>
        where.id === "pres1" && where.teamId === "tA" ? { id: "pres1" } : null,
    );
    prismaMock.comment.create.mockResolvedValue({
      id: "c1",
      body: "좋아요",
      slide: null,
      createdAt: new Date(),
    });

    const out = await addComment({ presentationId: "pres1", body: "좋아요", slide: null });
    expect(out.id).toBe("c1");
    expect(prismaMock.comment.create.mock.calls[0][0].data.authorId).toBe("jo");
  });

  it("다른 팀의 자료면 404 (교차 팀 차단) — 댓글 안 만듦", async () => {
    prismaMock.presentation.findFirst.mockResolvedValue(null); // tB 자료 → 스코핑 null
    await expect(
      addComment({ presentationId: "pres1", body: "x", slide: null }),
    ).rejects.toMatchObject({ status: 404 });
    expect(prismaMock.comment.create).not.toHaveBeenCalled();
  });
});

describe("toggleReaction — 부모 댓글 팀 스코핑", () => {
  it("활성 팀의 댓글이면 반응을 토글한다", async () => {
    prismaMock.comment.findFirst.mockImplementation(
      async ({ where }: { where: { id: string; presentation: { teamId: string } } }) =>
        where.id === "c1" && where.presentation.teamId === "tA" ? { id: "c1" } : null,
    );
    prismaMock.reaction.findUnique.mockResolvedValue(null);
    prismaMock.reaction.create.mockResolvedValue({});

    await toggleReaction({ presentationId: "pres1", commentId: "c1", emoji: "👍" });
    expect(prismaMock.reaction.create).toHaveBeenCalled();
  });

  it("다른 팀의 댓글이면 404 (교차 팀 차단) — 토글 안 함", async () => {
    prismaMock.comment.findFirst.mockResolvedValue(null);
    await expect(
      toggleReaction({ presentationId: "pres1", commentId: "c1", emoji: "👍" }),
    ).rejects.toMatchObject({ status: 404 });
    expect(prismaMock.reaction.create).not.toHaveBeenCalled();
    expect(prismaMock.reaction.delete).not.toHaveBeenCalled();
  });
});
