// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({ auth: vi.fn(),team: vi.fn(),asset: vi.fn(),sign: vi.fn(),download: vi.fn() }));
vi.mock("@/lib/auth",() => ({ requireAuth: mock.auth }));
vi.mock("@/lib/active-team",() => ({ getActiveTeam: mock.team }));
vi.mock("@/lib/prisma",() => ({ prisma: { presentationAsset: { findFirst: mock.asset } } }));
vi.mock("@/lib/storage",() => ({ signedDownloadUrl: mock.sign,downloadObject: mock.download, assertGeneratedPresentationStorage: vi.fn() }));
import { GET } from "../[assetId]/route";
const get = () => GET(new Request("http://localhost"),{ params: Promise.resolve({ id: "presentation",assetId: "asset" }) });
beforeEach(() => { vi.clearAllMocks(); mock.auth.mockResolvedValue({ memberId: "owner" }); mock.team.mockResolvedValue({ id: "active-team" }); mock.asset.mockResolvedValue({ url: "private/deck.html",type: "html",name: "발표.html" }); mock.download.mockResolvedValue(Buffer.from("<html>deck</html>")); mock.sign.mockResolvedValue("https://storage.test/signed"); });
it("requires active team ownership before downloading generated HTML as a sandboxed attachment",async () => {
  const result = await get(); expect(result.status).toBe(200); expect(mock.asset).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "asset",presentationId: "presentation",presentation: { teamId: "active-team" } } }));
  expect(result.headers.get("content-disposition")).toContain("attachment"); expect(result.headers.get("content-security-policy")).toContain("sandbox"); expect(mock.sign).not.toHaveBeenCalled();
});
it("denies absent team and preserves the existing short-lived PDF signed download",async () => {
  mock.team.mockResolvedValueOnce(null); expect((await get()).status).toBe(403); expect(mock.download).not.toHaveBeenCalled();
  mock.asset.mockResolvedValueOnce({ url: "private/deck.pdf",type: "pdf",name: "발표.pdf" }); expect((await get()).status).toBe(302); expect(mock.sign).toHaveBeenCalledWith("private/deck.pdf",60);
});
