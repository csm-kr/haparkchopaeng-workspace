// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ record: vi.fn(), paper: vi.fn(), update: vi.fn(), target: vi.fn(), create: vi.fn(), fetch: vi.fn(), transaction: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: { job: { findUnique: m.record, findUniqueOrThrow: m.record, update: vi.fn() }, paper: { findFirst: m.paper, updateMany: m.update }, $transaction: m.transaction } }));
vi.mock("@/lib/storage", () => ({ signedDownloadUrl: vi.fn() }));
vi.mock("@/lib/inngest", () => ({ inngest: { send: vi.fn() } }));
vi.mock("@/lib/local-agent/service", () => ({ assertJobTarget: m.target, createPreparedJob: m.create, getJob: vi.fn() }));
import { analysisSourceTarget, getLocalAnalysisState, prepareAnalysisRun } from "../service";
const scope = { teamId: "team", memberId: "member", sessionKey: "session", sessionExpiresAt: "2099-01-01T00:00:00Z" };
const payload = { paperId: "paper", scope, selection: { deviceId: "pc", provider: "codex", model: "fixture-model", requestId: "a5c7a878-d81b-44b9-804f-edc320ec0cb8" } };
beforeEach(() => {
  vi.resetAllMocks();
  m.record.mockResolvedValue({ id: "run", type: "prepare_local_analysis", status: "queued", createdAt: new Date(), payload });
  m.paper.mockResolvedValue({ id: "paper", title: "Synthetic paper", authors: "Fixture", teamId: "team", pdfUrl: "papers/fixture.pdf", sourceText: JSON.stringify([{ page: 1, text: "OCR source text", method: "ocr" }]), sourceDigest: "a".repeat(64) });
  m.update.mockResolvedValue({ count: 1 });
  m.target.mockResolvedValue(undefined);
  m.create.mockResolvedValue({ id: "local-job" });
  m.transaction.mockImplementation(async action => action({ paper: { updateMany: m.update }, job: { findUniqueOrThrow: m.record, update: vi.fn() } }));
});
afterEach(() => { vi.restoreAllMocks(); });

describe("analysis durable source admission", () => {
  it("derives the OCR notice from prepared/cached pages and tolerates invalid old cache on status reads", async () => {
    const webScope = { ...scope, sessionExpiresAt: new Date(scope.sessionExpiresAt) };
    expect((await getLocalAnalysisState(webScope, "paper")).sourceHasOcr).toBe(true);
    m.paper.mockResolvedValue({ id: "paper", sourceText: JSON.stringify([{ page: 1, text: "Existing native cache" }]), analysisRequestId: null });
    expect((await getLocalAnalysisState(webScope, "paper")).sourceHasOcr).toBe(false);
    m.paper.mockResolvedValue({ id: "paper", sourceText: "invalid old JSON cache", analysisRequestId: null });
    await expect(getLocalAnalysisState(webScope, "paper")).resolves.toMatchObject({ sourceHasOcr: false });
  });
  it("does not download or do inline native extraction when a prepared source is absent", async () => {
    m.paper.mockResolvedValue({ id: "paper", teamId: "team", sourceText: null, sourceDigest: null });
    await expect(prepareAnalysisRun("run")).rejects.toMatchObject({ code: "SOURCE_NOT_READY" });
    expect(m.create).not.toHaveBeenCalled();
    expect(m.transaction).not.toHaveBeenCalled();
  });
  it("keeps OCR method metadata in server context and locks the exact source snapshot before queue admission", async () => {
    await expect(prepareAnalysisRun("run")).resolves.toEqual({ jobId: "local-job" });
    expect(JSON.parse(m.create.mock.calls[0][2]).pages[0]).toEqual({ page: 1, text: "OCR source text", method: "ocr" });
    expect(m.update.mock.calls[0][0].where).toMatchObject({ teamId: "team", analysisRequestId: "run", analysisStatus: "pending", pdfUrl: "papers/fixture.pdf", sourceText: expect.any(String), sourceDigest: "a".repeat(64) });
  });
  it("never queues context if the current source snapshot changed before the admission lock", async () => {
    m.update.mockResolvedValue({ count: 0 });
    await expect(prepareAnalysisRun("run")).rejects.toMatchObject({ code: "SUPERSEDED" });
    expect(m.create).not.toHaveBeenCalled();
  });
  it("checks latest run, team, membership and current web execution authority for every source page", async () => {
    await expect(analysisSourceTarget("run")).resolves.toEqual({ kind: "paper", id: "paper", teamId: "team" });
    expect(m.paper.mock.calls[0][0].where).toEqual({ id: "paper", teamId: "team", analysisRequestId: "run", analysisStatus: "pending" });
    expect(m.target).toHaveBeenCalledWith({ ...scope, sessionExpiresAt: new Date(scope.sessionExpiresAt) }, payload.selection);
    m.target.mockRejectedValue(Object.assign(new Error("ended grant"), { status: 403 }));
    await expect(analysisSourceTarget("run")).rejects.toMatchObject({ status: 403 });
  });
  it("stops cancelled/superseded runs before source access", async () => {
    m.paper.mockResolvedValue(null);
    await expect(analysisSourceTarget("run")).rejects.toMatchObject({ code: "SUPERSEDED" });
    expect(m.target).not.toHaveBeenCalled();
  });
  it("does not extend the ten-minute preparation deadline or an expired session", async () => {
    m.record.mockResolvedValueOnce({ id: "run", type: "prepare_local_analysis", status: "queued", createdAt: new Date(Date.now() - 600_000), payload });
    await expect(analysisSourceTarget("run")).rejects.toMatchObject({ code: "EXPIRED" });
    m.record.mockResolvedValueOnce({ id: "run", type: "prepare_local_analysis", status: "queued", createdAt: new Date(), payload: { ...payload, scope: { ...scope, sessionExpiresAt: "2000-01-01T00:00:00Z" } } });
    await expect(analysisSourceTarget("run")).rejects.toMatchObject({ code: "SUPERSEDED" });
    expect(m.paper).not.toHaveBeenCalled();
  });
  it("rejects a final admission dispatched at 601 seconds after source preparation succeeded at 599 seconds", async () => {
    const start = Date.now();
    let now = start + 599_000;
    vi.spyOn(Date, "now").mockImplementation(() => now);
    m.record.mockResolvedValue({ id: "run", type: "prepare_local_analysis", status: "queued", createdAt: new Date(start), payload });
    await expect(analysisSourceTarget("run")).resolves.toMatchObject({ id: "paper" });
    now = start + 601_000;
    await expect(prepareAnalysisRun("run")).rejects.toMatchObject({ code: "EXPIRED" });
    expect(m.create).not.toHaveBeenCalled();
  });
  it("rechecks the original deadline after waiting for the admission transaction lock", async () => {
    const start = Date.now();
    let now = start + 599_000;
    vi.spyOn(Date, "now").mockImplementation(() => now);
    m.record.mockResolvedValue({ id: "run", type: "prepare_local_analysis", status: "queued", createdAt: new Date(start), payload });
    m.update.mockImplementation(async () => { now = start + 601_000; return { count: 1 }; });
    await expect(prepareAnalysisRun("run")).rejects.toMatchObject({ code: "EXPIRED" });
    expect(m.create).not.toHaveBeenCalled();
  });
});
