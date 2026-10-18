import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
const f = vi.hoisted(() => ({ agent: null as unknown, refresh: vi.fn(), open: vi.fn(), fetch: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => f }));
vi.mock("../provider", () => ({ useLocalAgent: () => f.agent }));
vi.mock("../model-picker", () => ({ LocalAgentModelPicker: () => <div>사용할 모델</div> }));
import { LocalPaperAnalysis } from "../paper-analysis";
beforeEach(() => {
  vi.clearAllMocks();
  f.agent = { phase: "idle", device: null, selectedModel: null, open: f.open };
  vi.stubGlobal("fetch", f.fetch);
  f.fetch.mockImplementation(async () => new Response(JSON.stringify({ data: { analysisStatus: "awaiting_ai", runId: null, canCancel: false, analysisError: null } }), { status: 200 }));
});
describe("local paper analysis controls", () => {
  it.each([true, false])("문자 인식 여부 %s를 실제 준비 결과로 표시하고 추론을 자동 시작하지 않는다", async sourceHasOcr => {
    f.fetch.mockImplementation(async () => new Response(JSON.stringify({ data: {
      analysisStatus: "awaiting_ai", runId: null, sourceHasOcr,
    } }), { status: 200 }));
    render(<LocalPaperAnalysis paperId="p1" initialStatus="pending" />);
    await screen.findByText("모델을 선택한 뒤 분석을 시작할 수 있어요.");
    if (sourceHasOcr) {
      expect(await screen.findByText(/스캔 페이지를 문자 인식으로 읽었어요/)).toHaveTextContent(/중요한 수치·인용은 원문 PDF/);
    } else expect(screen.queryByText(/스캔 페이지를 문자 인식으로 읽었어요/)).not.toBeInTheDocument();
    expect(f.fetch.mock.calls.every(([, init]) => init?.method === "GET")).toBe(true);
  });

  it("requires a connection and an explicit model without automatically starting inference", async () => {
    render(<LocalPaperAnalysis paperId="p1" initialStatus="awaiting_ai" />);
    expect(screen.getByRole("button", { name: "이 AI로 분석" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "AI 연결" }));
    expect(f.open).toHaveBeenCalledOnce();
    await waitFor(() => expect(f.fetch).toHaveBeenCalled());
    expect(f.fetch.mock.calls.every(([, init]) => !init?.method || init.method === "GET")).toBe(true);
  });
  it("submits the selected local model and keeps one request ID after a lost response", async () => {
    f.agent = { phase: "connected", device: { id: "pc" }, selectedModel: { provider: "codex", model: "real-model" }, open: f.open };
    let attempts = 0;
    f.fetch.mockImplementation(async (_url, init) => {
      if (init?.method === "POST") {
        if (++attempts === 1) throw new TypeError("network");
        return new Response(JSON.stringify({ data: { runId: "run", analysisStatus: "pending" } }), { status: 202 });
      }
      return new Response(JSON.stringify({ data: { analysisStatus: "awaiting_ai", canCancel: false, runId: null } }));
    });
    render(<LocalPaperAnalysis paperId="p1" initialStatus="awaiting_ai" />);
    fireEvent.click(screen.getByRole("button", { name: "이 AI로 분석" }));
    await screen.findByRole("alert");
    fireEvent.click(screen.getByRole("button", { name: "이 AI로 분석" }));
    await waitFor(() => expect(attempts).toBe(2));
    const requests = f.fetch.mock.calls.filter(([, init]) => init?.method === "POST").map(([, init]) => JSON.parse(init.body));
    expect(requests[0]).toMatchObject({ deviceId: "pc", provider: "codex", model: "real-model" });
    expect(requests[0].requestId).toBe(requests[1].requestId);
  });
  it("cancels the current analysis and displays its safe explanation", async () => {
    f.fetch.mockImplementation(async (_url, init) => new Response(JSON.stringify({ data: init?.method === "DELETE" ? { analysisStatus: "awaiting_ai", canCancel: false, runId: "run", analysisError: "분석을 중단했어요." } : { analysisStatus: "pending", canCancel: true, runId: "run" } })));
    render(<LocalPaperAnalysis paperId="p1" initialStatus="pending" />);
    fireEvent.click(await screen.findByRole("button", { name: "분석 중단" }));
    await screen.findByText("분석을 중단했어요.");
    expect(f.fetch.mock.calls.some(([, init]) => init?.method === "DELETE")).toBe(true);
  });

  it("keeps the admitted intent after a gateway error and retries with the same request ID", async () => {
    f.agent = { phase: "connected", device: { id: "pc" }, selectedModel: { provider: "codex", model: "real-model" }, open: f.open };
    let attempts = 0;
    f.fetch.mockImplementation(async (_url, init) => {
      if (init?.method === "POST") {
        if (++attempts === 1) return new Response(JSON.stringify({ error: { message: "잠시 후 다시 시도해주세요." } }), { status: 502 });
        return new Response(JSON.stringify({ data: { runId: "admitted-run", analysisStatus: "pending" } }), { status: 202 });
      }
      return new Response(JSON.stringify({ data: { analysisStatus: "awaiting_ai", runId: null } }));
    });
    render(<LocalPaperAnalysis paperId="p1" initialStatus="awaiting_ai" />);
    fireEvent.click(screen.getByRole("button", { name: "이 AI로 분석" }));
    await screen.findByRole("alert");
    fireEvent.click(screen.getByRole("button", { name: "이 AI로 분석" }));
    await waitFor(() => expect(attempts).toBe(2));
    const requests = f.fetch.mock.calls.filter(([, init]) => init?.method === "POST").map(([, init]) => JSON.parse(init.body));
    expect(requests[1].requestId).toBe(requests[0].requestId);
  });

  it("confirms a queue failure with the same ID before allowing a new explicit intent", async () => {
    f.agent = { phase: "connected", device: { id: "pc" }, selectedModel: { provider: "codex", model: "real-model" }, open: f.open };
    let attempts = 0;
    f.fetch.mockImplementation(async (_url, init) => {
      if (init?.method === "POST") {
        attempts++;
        if (attempts === 1) return new Response(JSON.stringify({ error: { code: "QUEUE_UNAVAILABLE", message: "분석 대기열에 연결하지 못했어요." } }), { status: 503 });
        return new Response(JSON.stringify({ data: { runId: attempts === 2 ? "failed-run" : "new-run", analysisStatus: attempts === 2 ? "failed" : "pending", analysisError: attempts === 2 ? "분석 대기열에 연결하지 못했어요." : null } }), { status: 202 });
      }
      return new Response(JSON.stringify({ data: { analysisStatus: "awaiting_ai", runId: null } }));
    });
    render(<LocalPaperAnalysis paperId="p1" initialStatus="awaiting_ai" />);
    fireEvent.click(screen.getByRole("button", { name: "이 AI로 분석" }));
    await screen.findByRole("alert");
    fireEvent.click(screen.getByRole("button", { name: "이 AI로 분석" }));
    await waitFor(() => expect(attempts).toBe(2));
    await waitFor(() => expect(screen.getByRole("button", { name: "이 AI로 분석" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "이 AI로 분석" }));
    await waitFor(() => expect(attempts).toBe(3));
    const requests = f.fetch.mock.calls.filter(([, init]) => init?.method === "POST").map(([, init]) => JSON.parse(init.body));
    expect(requests[1].requestId).toBe(requests[0].requestId);
    expect(requests[2].requestId).not.toBe(requests[0].requestId);
  });
});
