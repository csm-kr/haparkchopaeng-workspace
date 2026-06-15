import { beforeEach, describe, expect, it, vi } from "vitest";

// 섹션 노트 Server Action 팀 스코핑(ADR-020/R37) — 부모 Paper가 활성 팀 것일 때만.
// CRITICAL: 교차 팀 부모면 404(R19). authorId는 세션에서(R3) — 변하지 않는다.

const { requireAuthMock } = vi.hoisted(() => ({ requireAuthMock: vi.fn() }));
vi.mock("@/lib/auth", () => ({ requireAuth: requireAuthMock }));

const { getActiveTeamMock } = vi.hoisted(() => ({ getActiveTeamMock: vi.fn() }));
vi.mock("@/lib/active-team", () => ({ getActiveTeam: getActiveTeamMock }));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    paper: { findFirst: vi.fn() },
    sectionNote: { create: vi.fn(), findUnique: vi.fn(), delete: vi.fn() },
    member: { findUnique: vi.fn() },
  },
}));
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));

const { addNote, deleteNote } = await import("@/app/(app)/papers/[id]/actions");

beforeEach(() => {
  vi.clearAllMocks();
  requireAuthMock.mockResolvedValue({ memberId: "jo", role: "멤버" });
  getActiveTeamMock.mockResolvedValue({ id: "tA", slug: "alpha", role: "member" });
  prismaMock.member.findUnique.mockResolvedValue({
    id: "jo",
    name: "조성민",
    initial: "조",
    color: "var(--m-jo)",
  });
});

describe("addNote — 부모 논문 팀 스코핑", () => {
  it("활성 팀의 논문이면 노트를 만들고 authorId를 세션에서 주입한다", async () => {
    prismaMock.paper.findFirst.mockImplementation(
      async ({ where }: { where: { id: string; teamId: string } }) =>
        where.id === "p1" && where.teamId === "tA" ? { id: "p1" } : null,
    );
    prismaMock.sectionNote.create.mockResolvedValue({
      id: "n1",
      sectionId: "problem",
      lens: "research",
      title: "t",
      body: "b",
      createdAt: new Date(),
    });

    const out = await addNote({
      paperId: "p1",
      sectionId: "problem",
      lens: "research",
      title: "t",
      body: "b",
    });
    expect(out.id).toBe("n1");
    expect(prismaMock.sectionNote.create.mock.calls[0][0].data.authorId).toBe("jo");
  });

  it("다른 팀의 논문이면 404 (교차 팀 차단) — 노트 안 만듦", async () => {
    prismaMock.paper.findFirst.mockResolvedValue(null);
    await expect(
      addNote({ paperId: "p1", sectionId: "problem", lens: "research", title: "t", body: "b" }),
    ).rejects.toMatchObject({ status: 404 });
    expect(prismaMock.sectionNote.create).not.toHaveBeenCalled();
  });
});

describe("deleteNote — 부모 논문 팀 스코핑", () => {
  it("활성 팀의 노트(작성자 본인)면 삭제한다", async () => {
    prismaMock.sectionNote.findUnique.mockResolvedValue({
      id: "n1",
      authorId: "jo",
      paperId: "p1",
      paper: { teamId: "tA" },
    });
    prismaMock.sectionNote.delete.mockResolvedValue({});

    await deleteNote({ noteId: "n1", paperId: "p1" });
    expect(prismaMock.sectionNote.delete).toHaveBeenCalledWith({ where: { id: "n1" } });
  });

  it("다른 팀의 노트면 404 (교차 팀 차단) — 권한 체크 전에 막는다", async () => {
    // 관리자라도 다른 팀 노트는 못 지운다.
    requireAuthMock.mockResolvedValue({ memberId: "ha", role: "관리자" });
    prismaMock.sectionNote.findUnique.mockResolvedValue({
      id: "n1",
      authorId: "jo",
      paperId: "p1",
      paper: { teamId: "tB" }, // 활성 팀은 tA
    });

    await expect(
      deleteNote({ noteId: "n1", paperId: "p1" }),
    ).rejects.toMatchObject({ status: 404 });
    expect(prismaMock.sectionNote.delete).not.toHaveBeenCalled();
  });
});
