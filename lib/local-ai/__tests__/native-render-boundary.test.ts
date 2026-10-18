// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { FigureExtract } from "@/lib/analysis";

const m = vi.hoisted(() => ({
  db: {
    paper: { findFirst: vi.fn(), findUnique: vi.fn(), findUniqueOrThrow: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
    job: { findUnique: vi.fn(), findUniqueOrThrow: vi.fn(), create: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
    membership: { updateMany: vi.fn() }, localAgentJob: { updateMany: vi.fn() },
    analysis: { upsert: vi.fn() }, figure: { deleteMany: vi.fn(), createMany: vi.fn() }, $transaction: vi.fn(),
  },
  session: vi.fn(), team: vi.fn(), nativeLoad: vi.fn(), target: vi.fn(), prepared: vi.fn(), getJob: vi.fn(),
  send: vi.fn(), download: vi.fn(), fetch: vi.fn(), render: vi.fn(),
}));
vi.mock("@/lib/prisma", () => ({ prisma: m.db }));
vi.mock("@/lib/auth", () => ({ getConnectionSession: m.session }));
vi.mock("@/lib/active-team", () => ({ getActiveTeam: m.team }));
vi.mock("@/lib/inngest", () => ({ inngest: { send: m.send } }));
vi.mock("@/lib/storage", () => ({ signedDownloadUrl: m.download }));
vi.mock("@/lib/local-agent/service", () => ({ assertJobTarget: m.target, createPreparedJob: m.prepared, getJob: m.getJob }));

const scope = { memberId: "fixture-member", teamId: "fixture-team", sessionKey: "fixture-web-session", sessionExpiresAt: new Date("2099-01-01T00:00:00Z") };
const paperId = "fixture-paper";
const runId = "fixture-analysis-run";
const selection = { deviceId: "fixture-pc", provider: "codex" as const, model: "fixture-model", requestId: "7315709c-37f4-46b8-86cc-e7df099d7111" };
const sourceText = JSON.stringify([{ page: 1, text: "Our method reduces memory usage. We train for ten epochs using Adam. Figure 1: Model architecture." }]);
const syntheticPdf = "%PDF-synthetic-renderer-fixture";
function paper() {
  return { id: paperId, teamId: scope.teamId, title: "Synthetic paper", authors: "Fixture author", pdfUrl: "synthetic/source.pdf", pageCount: 1,
    analysisStatus: "pending", analysisError: null, analysisRequestId: runId, analysisStartedAt: null, sourceText, sourceDigest: "a".repeat(64) };
}
function record() {
  return { id: runId, type: "prepare_local_analysis", status: "running", payload: {
    paperId, scope: { ...scope, sessionExpiresAt: scope.sessionExpiresAt.toISOString() }, selection, jobId: "fixture-local-job",
  } };
}
function bundle(withFigure = false) {
  const table = { caption: "미기재", columns: [], rows: [] };
  return {
    research: { problem: { oneLine: "메모리 사용 감소", setting: "원문 p.1", assumptions: [] }, contributions: ["메모리 사용 감소"],
      io: { inputs: [], outputs: [] }, comparison: table, ablation: table },
    repro: { data: table, model: { params: "미기재", items: [] }, loss: [], metrics: [], training: { caption: "원문 p.1", rows: [] },
      gpu: { hardware: "미기재", count: 0, vramGb: 0, vramUsedGb: 0, trainDays: 0, note: "미기재" },
      repo: { found: false, url: null, summary: "외부 저장소 미확인", tree: [], source: "paper" }, diagram: { nodes: [], edges: [] } },
    figures: withFigure ? [{ title: "Figure 1", caption: "Figure 1: Model architecture.", interpretation: "모델 구조", sourcePage: 1 }] : [],
    references: [{ lens: "research", sourcePage: 1, quote: "Our method reduces memory usage." },
      { lens: "repro", sourcePage: 1, quote: "train for ten epochs using Adam" }],
  };
}

beforeEach(() => {
  vi.resetModules();
  vi.resetAllMocks();
  m.session.mockResolvedValue({ ...scope, expiresAt: scope.sessionExpiresAt });
  m.team.mockResolvedValue({ id: scope.teamId });
  m.db.paper.findFirst.mockResolvedValue(paper());
  m.db.paper.findUnique.mockResolvedValue(paper());
  m.db.paper.findUniqueOrThrow.mockResolvedValue(paper());
  m.db.paper.updateMany.mockResolvedValue({ count: 1 });
  m.db.job.findUnique.mockResolvedValue(record());
  m.db.job.findUniqueOrThrow.mockResolvedValue(record());
  m.db.membership.updateMany.mockResolvedValue({ count: 1 });
  m.db.$transaction.mockImplementation(async action => action(m.db));
  m.target.mockResolvedValue(undefined);
  m.prepared.mockResolvedValue({ id: "fixture-local-job" });
  m.getJob.mockResolvedValue({ status: "completed", response: JSON.stringify(bundle()) });
  m.send.mockResolvedValue({ ids: ["synthetic-event"] });
  m.download.mockResolvedValue("https://storage.invalid/synthetic-paper.pdf");
  m.fetch.mockResolvedValue(new Response(syntheticPdf));
  vi.stubGlobal("fetch", m.fetch);
  // Fail while evaluating the module, as an unavailable native binary does, not only inside renderFigures().
  vi.doMock("@/lib/figure-render", () => {
    m.nativeLoad();
    throw Object.assign(new Error("Synthetic native renderer unavailable"), { code: "ERR_DLOPEN_FAILED" });
  });
});
afterEach(() => { vi.unstubAllGlobals(); });

it("native Figure 모듈을 로드할 수 없어도 GET 분석 상태는 JSON으로 조회한다", async () => {
  const { GET } = await import("@/app/api/papers/[id]/reanalyze/route");
  const response = await GET(new Request(`http://localhost/api/papers/${paperId}/reanalyze`), { params: Promise.resolve({ id: paperId }) });

  expect(response.status).toBe(200);
  expect(response.headers.get("content-type")).toContain("application/json");
  expect(await response.json()).toEqual({ data: {
    id: paperId, analysisStatus: "pending", analysisError: null, runId, sourceReady: true, sourceHasOcr: false, canCancel: true,
  } });
  expect(m.nativeLoad).not.toHaveBeenCalled();
});

it("native Figure 모듈 없이 실제 POST가 분석 요청을 한 번 적재한다", async () => {
  m.db.job.findUnique.mockResolvedValue(null);
  m.db.paper.findUniqueOrThrow.mockResolvedValue({ ...paper(), analysisRequestId: null });
  const { POST } = await import("@/app/api/papers/[id]/reanalyze/route");
  const response = await POST(new Request(`http://localhost/api/papers/${paperId}/reanalyze`, {
    method: "POST", headers: { "Content-Type": "application/json", Origin: "http://localhost" }, body: JSON.stringify(selection),
  }), { params: Promise.resolve({ id: paperId }) });

  expect(response.status).toBe(202);
  expect(await response.json()).toMatchObject({ data: { id: paperId, analysisStatus: "pending" } });
  expect(m.target).toHaveBeenCalledWith(scope, selection);
  expect(m.db.job.create).toHaveBeenCalledTimes(1);
  expect(m.send).toHaveBeenCalledTimes(1);
  expect(m.nativeLoad).not.toHaveBeenCalled();
  expect(m.fetch).not.toHaveBeenCalled();
});

it("캐시 원문에서 작업을 준비할 때 Figure 모듈이나 PDF 다운로드를 요구하지 않는다", async () => {
  const pendingRun = record();
  const { jobId: _jobId, ...payload } = pendingRun.payload;
  m.db.job.findUnique.mockResolvedValue({ ...pendingRun, payload });
  const { prepareAnalysisRun } = await import("../service");

  await expect(prepareAnalysisRun(runId)).resolves.toEqual({ jobId: "fixture-local-job" });
  expect(m.prepared).toHaveBeenCalledTimes(1);
  expect(JSON.parse(m.prepared.mock.calls[0][2])).toMatchObject({ pages: [{ page: 1, text: expect.stringContaining("reduces memory usage") }] });
  expect(m.nativeLoad).not.toHaveBeenCalled();
  expect(m.fetch).not.toHaveBeenCalled();
});

it("Figure가 없는 검증된 분석은 renderer를 로드하지 않고 두 관점을 저장한다", async () => {
  const { finishAnalysisRun } = await import("../service");

  await expect(finishAnalysisRun(runId)).resolves.toBe("ready");
  expect(m.nativeLoad).not.toHaveBeenCalled();
  expect(m.fetch).not.toHaveBeenCalled();
  expect(m.db.analysis.upsert).toHaveBeenCalledTimes(2);
  expect(m.db.figure.createMany).not.toHaveBeenCalled();
  expect(m.db.job.update).toHaveBeenCalledWith({ where: { id: runId }, data: { status: "done", lastError: null } });
});

it("Figure 모듈 평가 실패를 격리하고 검증된 캡션과 두 관점을 보존한다", async () => {
  m.getJob.mockResolvedValue({ status: "completed", response: JSON.stringify(bundle(true)) });
  const { finishAnalysisRun } = await import("../service");

  await expect(finishAnalysisRun(runId)).resolves.toBe("ready");
  expect(m.nativeLoad).toHaveBeenCalledTimes(1);
  expect(m.fetch).not.toHaveBeenCalled();
  expect(m.db.analysis.upsert).toHaveBeenCalledTimes(2);
  expect(m.db.figure.createMany).toHaveBeenCalledWith({ data: [expect.objectContaining({
    paperId, caption: "Figure 1: Model architecture.", sourcePage: 1, imageUrl: null,
  })] });
});

it("Figure가 필요하고 renderer가 정상이라면 PDF와 검증된 Figure를 전달해 렌더한다", async () => {
  vi.doMock("@/lib/figure-render", () => { m.nativeLoad(); return { renderFigures: m.render }; });
  m.render.mockImplementation(async (_pdf: Buffer, _namespace: string, figures: FigureExtract[]) =>
    figures.map(figure => ({ ...figure, imageUrl: "figures/synthetic-render.png" })));
  m.getJob.mockResolvedValue({ status: "completed", response: JSON.stringify(bundle(true)) });
  const { finishAnalysisRun } = await import("../service");

  await expect(finishAnalysisRun(runId)).resolves.toBe("ready");
  expect(m.nativeLoad).toHaveBeenCalledTimes(1);
  expect(m.render).toHaveBeenCalledWith(Buffer.from(syntheticPdf), `${paperId}/${runId}`, [expect.objectContaining({
    caption: "Figure 1: Model architecture.", sourcePage: 1, imageUrl: null,
  })]);
  expect(m.db.figure.createMany).toHaveBeenCalledWith({ data: [expect.objectContaining({ imageUrl: "figures/synthetic-render.png" })] });
});

it("원문에 없는 인용은 renderer 로딩 전에 거절하며 분석 결과를 저장하지 않는다", async () => {
  const output = bundle(true);
  output.references[0].quote = "This quotation is absent from the synthetic source.";
  m.getJob.mockResolvedValue({ status: "completed", response: JSON.stringify(output) });
  const { finishAnalysisRun } = await import("../service");

  await expect(finishAnalysisRun(runId)).resolves.toBe("failed");
  expect(m.nativeLoad).not.toHaveBeenCalled();
  expect(m.fetch).not.toHaveBeenCalled();
  expect(m.db.analysis.upsert).not.toHaveBeenCalled();
  expect(m.db.figure.createMany).not.toHaveBeenCalled();
  expect(m.db.job.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "failed" }) }));
});
