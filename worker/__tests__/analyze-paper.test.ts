// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PaperSourceError } from "@/lib/local-ai/source";
const f = vi.hoisted(() => ({ handler: null as null | ((arg: unknown) => Promise<unknown>), source: vi.fn(), target: vi.fn(), prepare: vi.fn(), read: vi.fn(), finish: vi.fn(), fail: vi.fn(), legacy: vi.fn(), broadcast: vi.fn(), update: vi.fn() }));
vi.mock("../prepare-pdf-source", () => ({ preparePdfSource: f.source }));
vi.mock("@/lib/inngest", () => ({ inngest: { createFunction: (_config: unknown, handler: (arg: unknown) => Promise<unknown>) => { f.handler = handler; return handler; } } }));
vi.mock("@/lib/local-ai/service", () => ({ analysisSourceTarget: f.target, prepareAnalysisRun: f.prepare, readAnalysisJob: f.read, finishAnalysisRun: f.finish, failAnalysisRun: f.fail }));
vi.mock("@/lib/analysis", () => ({ analyzePaper: f.legacy }));
vi.mock("@/lib/prisma", () => ({ prisma: { paper: { findUnique: vi.fn().mockResolvedValue({ teamId: "team", title: "Paper" }), updateMany: f.update } } }));
vi.mock("@/lib/realtime", () => ({ broadcastPaperAnalyzed: f.broadcast }));
await import("../analyze-paper");
const execute = (data: unknown) => f.handler!({ event: { data }, step: { run: async (_name: string, action: () => unknown) => action(), sleep: vi.fn().mockResolvedValue(undefined) } });
beforeEach(() => { vi.clearAllMocks(); f.update.mockReset().mockResolvedValue({ count: 1 }); f.source.mockReset().mockResolvedValue({ text: "pages" }); f.target.mockResolvedValue({ kind: "paper", id: "paper", teamId: "team" }); f.prepare.mockResolvedValue({ jobId: "job" }); f.read.mockResolvedValue({ status: "completed" }); f.finish.mockResolvedValue("ready"); });
describe("paper durable runner", () => {
  it("runs the PDF orchestrator outside a durable step so its page steps can be replayed separately", async () => {
    let active = false;
    const step = { run: async (_name: string, action: () => unknown): Promise<unknown> => {
      expect(active, "nested durable step").toBe(false);
      active = true;
      try { return await action(); } finally { active = false; }
    }, sleep: vi.fn() };
    f.source.mockImplementation(async (_target, receivedStep) => {
      expect(receivedStep).toBe(step);
      await receivedStep.run("fixture-page", async () => ({ page: 1, text: "OCR" }));
    });
    await f.handler!({ event: { data: { paperId: "paper" } }, step });
    expect(f.source).toHaveBeenCalledWith({ kind: "paper", id: "paper" }, step);
    expect(f.update).not.toHaveBeenCalled();
  });
  it("an upload prepares text without invoking the former paid analysis API", async () => {
    await execute({ paperId: "paper" });
    expect(f.source).toHaveBeenCalledWith({ kind: "paper", id: "paper" }, expect.objectContaining({ run: expect.any(Function) }));
    expect(f.legacy).not.toHaveBeenCalled();
    expect(f.prepare).not.toHaveBeenCalled();
  });
  it("collects a local completion and notifies only after validated persistence", async () => {
    await execute({ paperId: "paper", runId: "run" });
    expect(f.prepare).toHaveBeenCalledWith("run");
    expect(f.read).toHaveBeenCalledWith("run");
    expect(f.finish).toHaveBeenCalledWith("run");
    expect(f.broadcast).toHaveBeenCalledOnce();
    expect(f.legacy).not.toHaveBeenCalled();
  });
  it("does not announce a malformed result as a finished analysis", async () => {
    f.finish.mockResolvedValue("failed");
    await execute({ paperId: "paper", runId: "run" });
    expect(f.broadcast).not.toHaveBeenCalled();
  });
  it("keeps an owned OCR failure message for an explicit analysis without leaking native exceptions", async () => {
    f.source.mockRejectedValueOnce(new PaperSourceError("OCR_TIMEOUT"));
    await execute({ paperId: "paper", runId: "run" });
    expect(f.fail).toHaveBeenCalledWith("run", expect.stringContaining("이미지 본문을 읽는 시간이"));
    expect(f.prepare).not.toHaveBeenCalled();
    f.fail.mockClear();
    f.source.mockRejectedValueOnce(new Error("private native path"));
    await execute({ paperId: "paper", runId: "run" });
    expect(f.fail).toHaveBeenCalledWith("run");
  });
  it.each(["pending", "ready"])("records a safe source failure while preserving a previous %s analysis", async (initialStatus) => {
    const paper = { id: "paper", sourceText: null, analysisRequestId: null, analysisStatus: initialStatus, analysisError: null };
    f.update.mockImplementation(async ({ where, data }) => {
      const statusMatches = where.analysisStatus === undefined || where.analysisStatus === paper.analysisStatus || (typeof where.analysisStatus === "object" && where.analysisStatus.not !== paper.analysisStatus);
      const matches = statusMatches && (where.sourceText === undefined || where.sourceText === paper.sourceText) && (where.analysisRequestId === undefined || where.analysisRequestId === paper.analysisRequestId);
      if (matches) Object.assign(paper, data);
      return { count: matches ? 1 : 0 };
    });
    const failure = new PaperSourceError("PAGE_LIMIT");
    failure.message = "raw provider error and private filesystem path";
    f.source.mockRejectedValue(failure);
    await execute({ paperId: "paper" });
    expect(paper.analysisStatus).toBe(initialStatus === "pending" ? "failed" : "ready");
    expect(paper.analysisError).toBe("PDF는 1~30쪽까지 분석할 수 있어요.");
    expect(f.prepare).not.toHaveBeenCalled();
    expect(f.broadcast).not.toHaveBeenCalled();
  });
  it("does not publish unexpected native exception text", async () => {
    f.source.mockRejectedValue(new Error("private PDF path and provider credentials"));
    await execute({ paperId: "paper" });
    for (const [{ data }] of f.update.mock.calls) {
      expect(data.analysisError).toBe("PDF 본문을 준비하지 못했어요. 텍스트를 포함한 PDF인지 확인하거나 AI 연결 후 다시 분석해주세요.");
    }
  });
  it.each([
    { sourceText: "newer prepared original", analysisStatus: "ready", analysisRequestId: null, analysisError: null },
    { sourceText: null, analysisStatus: "pending", analysisRequestId: "newer-run", analysisError: null },
  ])("does not replace a newer original source or explicit active analysis: %j", async (paper) => {
    const before = { ...paper };
    f.source.mockRejectedValue(new PaperSourceError("NO_TEXT"));
    f.update.mockImplementation(async ({ where, data }) => {
      const statusMatches = where.analysisStatus === paper.analysisStatus || (typeof where.analysisStatus === "object" && where.analysisStatus.not !== paper.analysisStatus);
      const matches = statusMatches && where.sourceText === paper.sourceText && (where.analysisRequestId === undefined || where.analysisRequestId === paper.analysisRequestId);
      if (matches) Object.assign(paper, data);
      return { count: matches ? 1 : 0 };
    });
    await execute({ paperId: "paper" });
    expect(paper).toEqual(before);
  });
});
