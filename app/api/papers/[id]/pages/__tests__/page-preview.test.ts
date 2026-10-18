// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({ auth: vi.fn(),team: vi.fn(),paper: vi.fn(),download: vi.fn(),count: vi.fn(),render: vi.fn() }));
vi.mock("@/lib/auth",() => ({ requireAuth: mock.auth }));
vi.mock("@/lib/active-team",() => ({ getActiveTeam: mock.team }));
vi.mock("@/lib/prisma",() => ({ prisma: { paper: { findFirst: mock.paper } } }));
vi.mock("@/lib/storage",() => ({ downloadObject: mock.download }));
vi.mock("@/lib/pdf-page-render",() => ({ countPdfPages: mock.count,renderPdfPageToPng: mock.render }));
import { GET } from "../[n]/route";
const get = (n: string) => GET(new Request("http://localhost"),{ params: Promise.resolve({ id: "paper",n }) });
beforeEach(() => { vi.clearAllMocks(); mock.auth.mockResolvedValue({ memberId: "owner" }); mock.team.mockResolvedValue({ id: "team" }); mock.paper.mockResolvedValue({ pdfUrl: "private/source.pdf" }); mock.download.mockResolvedValue(Buffer.from("pdf")); mock.count.mockReturnValue(3); mock.render.mockReturnValue(Buffer.from("png")); });
it("scopes a real original page to the active team and checks bounds before rendering",async () => {
  const response = await get("2"); expect(response.status).toBe(200); expect(response.headers.get("content-type")).toBe("image/png");
  expect(mock.paper).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "paper",teamId: "team" } })); expect(mock.render).toHaveBeenCalledWith(Buffer.from("pdf"),1);
  mock.render.mockClear(); expect((await get("4")).status).toBe(404); expect(mock.render).not.toHaveBeenCalled();
});
it("rejects malformed pages and absent membership before accessing private PDF bytes",async () => {
  for (const value of ["0","-1","1.5","1x","301"]) expect((await get(value)).status).toBe(400);
  expect(mock.download).not.toHaveBeenCalled(); mock.team.mockResolvedValueOnce(null); expect((await get("1")).status).toBe(404); expect(mock.download).not.toHaveBeenCalled();
});
