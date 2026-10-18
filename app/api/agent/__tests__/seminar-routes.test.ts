// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({ session: vi.fn(), team: vi.fn(), turn: vi.fn(), enqueue: vi.fn(), get: vi.fn(), download: vi.fn() }));
vi.mock("@/lib/auth",() => ({ getConnectionSession: mock.session }));
vi.mock("@/lib/active-team",() => ({ getActiveTeam: mock.team }));
vi.mock("@/lib/agent/service",() => ({ continueSeminarTask: mock.turn, queueSeminarExport: mock.enqueue }));
vi.mock("@/lib/seminar/exports",() => ({ getSeminarExport: mock.get, downloadSeminarExport: mock.download }));
import { POST as turn } from "../tasks/[id]/seminar/route";
import { POST as enqueue } from "../tasks/[id]/exports/route";
import { GET as status } from "../tasks/[id]/exports/[jobId]/route";
import { GET as download } from "../tasks/[id]/exports/[jobId]/file/route";

const origin = "http://localhost:3000", params = () => ({ params: Promise.resolve({ id: "task", jobId: "artifact" }) });
const request = (body: unknown, from = origin) => new Request(origin+"/api/agent/tasks/task",{ method: "POST", headers: { Origin: from,"Content-Type": "application/json" },body: JSON.stringify(body) });
const draft = { title: "검토한 PT", durationMinutes: 30, summary: "원문 근거로 토론", keypoints: ["기여"], citations: [{ page: 1,quote: "An exact source quotation" }], slides: [1,2,3].map(n => ({ title: `슬라이드 ${n}`,body: "논문 근거" })) };
beforeEach(() => {
  vi.clearAllMocks(); mock.session.mockResolvedValue({ memberId: "owner",sessionKey: "session",expiresAt: new Date(Date.now()+60_000) }); mock.team.mockResolvedValue({ id: "team" });
  mock.turn.mockResolvedValue({ id: "task" }); mock.enqueue.mockResolvedValue({ export: { id: "artifact" } }); mock.get.mockResolvedValue({ id: "artifact",status: "done" }); mock.download.mockResolvedValue({ bytes: Buffer.from("<html>safe</html>"),contentType: "text/html; charset=utf-8",title: "한글 발표" });
});
it("admits one explicit conversational action with server session/team authority",async () => {
  const input = { action: "answer",text: "재현 조건을 깊게 설명하자",requestId: crypto.randomUUID(),expectedVersion: 3 };
  expect((await turn(request(input),params())).status).toBe(202);
  expect(mock.turn).toHaveBeenCalledWith(expect.objectContaining({ memberId: "owner",teamId: "team",sessionKey: "session" }),"task",input);
  for (const extra of [{ teamId: "foreign" },{ sourceText: "forged" },{ approved: true }]) expect((await turn(request({ ...input,...extra }),params())).status).toBe(400);
  expect((await turn(request(input,"https://foreign.invalid"),params())).status).toBe(403);
});
it("queues an immutable reviewed export and rejects injected asset paths or identity",async () => {
  const input = { requestId: crypto.randomUUID(),expectedVersion: 4,seminar: draft };
  expect((await enqueue(request(input),params())).status).toBe(202);
  expect(mock.enqueue).toHaveBeenCalledWith(expect.objectContaining({ memberId: "owner",teamId: "team" }),"task",input);
  expect((await enqueue(request({ ...input,objectPath: "foreign/object" }),params())).status).toBe(400);
  expect((await enqueue(request(input,"https://foreign.invalid"),params())).status).toBe(403);
  mock.session.mockResolvedValueOnce(null); expect((await enqueue(request(input),params())).status).toBe(401);
});
it("serves private status and attachment-only HTML through the verified owner service",async () => {
  const result = await status(new Request(origin),params()); expect(result.headers.get("cache-control")).toContain("no-store");
  const file = await download(new Request(origin+"?format=html"),params()); expect(file.status).toBe(200);
  expect(file.headers.get("content-disposition")).toContain("attachment;"); expect(file.headers.get("content-security-policy")).toContain("sandbox"); expect(file.headers.get("x-content-type-options")).toBe("nosniff");
  expect(mock.download).toHaveBeenCalledWith(expect.objectContaining({ memberId: "owner",teamId: "team" }),"task","artifact","html");
  expect((await download(new Request(origin+"?format=pptx"),params())).status).toBe(400);
  mock.team.mockResolvedValueOnce(null); expect((await download(new Request(origin+"?format=html"),params())).status).toBe(403);
});
