// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({ session: vi.fn(), team: vi.fn(), create: vi.fn(), list: vi.fn(), get: vi.fn(), control: vi.fn(), save: vi.fn(), saveSeminar: vi.fn(), revalidate: vi.fn() }));
vi.mock("@/lib/auth", () => ({ getConnectionSession: mock.session }));
vi.mock("@/lib/active-team", () => ({ getActiveTeam: mock.team }));
vi.mock("@/lib/agent/service", () => ({ createTask: mock.create, listTasks: mock.list, getTask: mock.get, controlTask: mock.control, saveTaskNote: mock.save, saveTaskSeminar: mock.saveSeminar }));
vi.mock("next/cache", () => ({ revalidatePath: mock.revalidate }));
import { GET as list, POST as create } from "../tasks/route";
import { GET as detail, POST as control } from "../tasks/[id]/route";
import { POST as save } from "../tasks/[id]/save/route";

const origin = "http://localhost:3000";
const input = { requestId: "59a99ddb-d663-4cb6-bdb7-c78bc7031b8e", deviceId: "pc", provider: "codex", model: "actual-model", paperId: "paper", goal: "논문을 읽고 토론 노트 초안을 만들어줘" };
const req = (body: unknown, from = origin) => new Request(origin + "/api/agent/tasks", { method: "POST", headers: { Origin: from, "Content-Type": "application/json" }, body: JSON.stringify(body) });
const params = () => ({ params: Promise.resolve({ id: "task" }) });
beforeEach(() => {
  vi.clearAllMocks();
  mock.session.mockResolvedValue({ memberId: "server-owner", sessionKey: "server-session", expiresAt: new Date(Date.now() + 60_000) });
  mock.team.mockResolvedValue({ id: "server-team" });
  mock.create.mockResolvedValue({ id: "task" }); mock.list.mockResolvedValue([]); mock.get.mockResolvedValue({ id: "task" }); mock.control.mockResolvedValue({ id: "task" }); mock.save.mockResolvedValue({ paper: { id: "paper" }, savedNote: { verified: true } });
});
describe("authenticated private task API", () => {
  it("registers a reviewed seminar and refreshes the actual presentation", async () => {
    const seminar = { title: "논문 세미나", durationMinutes: 30, summary: "논문 기여와 한계", keypoints: ["토론"], slides: [{ title: "문제", body: "문제" }, { title: "방법", body: "방법" }, { title: "토론", body: "질문" }], citations: [{ page: 1, quote: "The verified source quote." }] };
    mock.saveSeminar.mockResolvedValue({ paper: { id: "paper" }, savedPresentation: { id: "presentation", verified: true } });
    expect((await save(req({ expectedVersion: 2, seminar }), params())).status).toBe(200);
    expect(mock.saveSeminar).toHaveBeenCalledWith(expect.objectContaining({ teamId: "server-team", memberId: "server-owner" }), "task", { expectedVersion: 2, seminar });
    expect(mock.revalidate).toHaveBeenCalledWith("/presentations/presentation");
    expect(mock.save).not.toHaveBeenCalled();
  });
  it("derives execution scope at the server and does not cache private task responses", async () => {
    const result = await create(req(input));
    expect(result.status).toBe(202);
    expect(result.headers.get("cache-control")).toContain("no-store");
    expect(mock.create).toHaveBeenCalledWith(expect.objectContaining({ memberId: "server-owner", teamId: "server-team", sessionKey: "server-session" }), input);
    expect((await list(new Request(origin + "/api/agent/tasks?conversationId=thread"))).status).toBe(200);
    expect(mock.list).toHaveBeenCalledWith(expect.objectContaining({ teamId: "server-team" }), "thread");
    expect((await detail(new Request(origin), params())).status).toBe(200);
  });
  it("rejects foreign origins and forged authority, raw context, tools and approval", async () => {
    expect((await create(req(input, "https://foreign.invalid"))).status).toBe(403);
    for (const extra of [{ teamId: "foreign" }, { memberId: "other" }, { context: "forged" }, { tool: "shell" }, { approved: true }]) expect((await create(req({ ...input, ...extra }))).status).toBe(400);
    expect(mock.create).not.toHaveBeenCalled();
  });
  it("requires authentication and team membership before invoking task services", async () => {
    mock.session.mockResolvedValueOnce(null);
    expect((await create(req(input))).status).toBe(401);
    mock.team.mockResolvedValueOnce(null);
    expect((await create(req(input))).status).toBe(403);
    expect(mock.create).not.toHaveBeenCalled();
  });
  it("requires an expected version for controls and reviewed saves and refreshes the real paper", async () => {
    expect((await control(req({ action: "cancel" }), params())).status).toBe(400);
    expect((await control(req({ action: "cancel", expectedVersion: 2 }), params())).status).toBe(202);
    const reviewed = { expectedVersion: 2, title: "검토한 제목", body: "검토한 내용" };
    expect((await save(req({ ...reviewed, lens: "any" }), params())).status).toBe(400);
    expect((await save(req(reviewed), params())).status).toBe(200);
    expect(mock.save).toHaveBeenCalledWith(expect.objectContaining({ memberId: "server-owner" }), "task", reviewed);
    expect(mock.revalidate).toHaveBeenCalledWith("/papers/paper");
  });
});
