// @vitest-environment node
import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { StepError } from "inngest";
import { HttpError } from "@/lib/http";
import { PaperSourceError } from "@/lib/local-ai/source";
const m = vi.hoisted(() => ({ paper: vi.fn(), presentation: vi.fn(), update: vi.fn(), signed: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: { paper: { findFirst: m.paper, updateMany: m.update }, presentation: { findFirst: m.presentation } } }));
vi.mock("@/lib/storage", () => ({ signedDownloadUrl: m.signed }));
import { preparePdfSource, verifyPreparedPdfSource, type PdfSourceStep } from "../prepare-pdf-source";

const target = { kind: "paper" as const, id: "synthetic-paper", teamId: "team" };
const pdf = Buffer.from("%PDF-synthetic-page-flow");
const digest = createHash("sha256").update(pdf).digest("hex");
const pages = JSON.stringify([{ page: 1, text: "" }, { page: 2, text: "Native short text" }]);
const inspected = { text: pages, digest, pageCount: 2, ocrPages: [1] };
let row: { id: string; teamId: string; pdfUrl: string; sourceText: string | null; sourceDigest: string | null; pageCount: number | null; analysisStatus: string };
let load: ReturnType<typeof vi.fn>, inspect: ReturnType<typeof vi.fn>, recognize: ReturnType<typeof vi.fn>, guard: ReturnType<typeof vi.fn>;
function steps(before: (name: string) => void = () => {}, serializeErrors = false) {
  let active = false;
  const outputs: unknown[] = [], names: string[] = [];
  const run = async (name: string, action: () => Promise<unknown>) => {
    expect(active, "nested durable step").toBe(false);
    active = true;
    before(name);
    names.push(name);
    try {
      const output = await action();
      // Durable outputs must serialize without Buffer payloads or live native handles.
      expect(JSON.stringify(output)).not.toContain('"type":"Buffer"');
      outputs.push(output);
      return JSON.parse(JSON.stringify(output));
    } catch (error) {
      if (serializeErrors && error instanceof Error) throw new StepError(name, { name: error.name, message: error.message });
      throw error;
    } finally { active = false; }
  };
  return { step: { run } as PdfSourceStep, names, outputs };
}
const dependencies = () => ({ loadObject: load, inspect, recognize });
beforeEach(() => {
  vi.resetAllMocks();
  row = { id: target.id, teamId: target.teamId, pdfUrl: "papers/synthetic.pdf", sourceText: null, sourceDigest: null, pageCount: null, analysisStatus: "pending" };
  m.paper.mockImplementation(async ({ where }) => where.id === row.id && (!where.teamId || where.teamId === row.teamId) ? { ...row } : null);
  m.update.mockImplementation(async ({ where, data }) => {
    const matches = Object.entries(where).every(([key, value]) => key === "analysisRequestId" ? value === null : row[key as keyof typeof row] === value);
    if (matches) Object.assign(row, data);
    return { count: matches ? 1 : 0 };
  });
  load = vi.fn().mockResolvedValue(pdf);
  inspect = vi.fn().mockResolvedValue(inspected);
  recognize = vi.fn().mockResolvedValue("Recognized synthetic scanned text.");
  guard = vi.fn().mockResolvedValue(undefined);
});

describe("durable PDF source preparation", () => {
  it("separates inspection, every OCR page and complete cache CAS without nesting or persisting PDF bytes", async () => {
    const runner = steps();
    const result = await preparePdfSource(target, runner.step, guard, dependencies());
    expect(runner.names).toEqual([`pdf-paper-${target.id}-inspect`, `pdf-paper-${target.id}-ocr-1`, `pdf-paper-${target.id}-cache`]);
    expect(load).toHaveBeenCalledTimes(2);
    expect(inspect).toHaveBeenCalledWith(pdf, { maxPages: 30 });
    expect(recognize).toHaveBeenCalledWith(pdf, expect.objectContaining({ page: 1, maxPages: 30, expectedDigest: digest, timeoutMs: 40_000 }));
    expect(JSON.parse(result.source!.text)).toEqual([{ page: 1, text: "Recognized synthetic scanned text.", method: "ocr" }, { page: 2, text: "Native short text" }]);
    expect(row.sourceText).toBe(result.source!.text);
    expect(row.analysisStatus).toBe("awaiting_ai");
    expect(guard).toHaveBeenCalledTimes(7);
    await expect(verifyPreparedPdfSource(result)).resolves.toBeUndefined();
  });

  it("reuses an old native-text cache without PDF/OCR and recovers only the upload pending state", async () => {
    row.sourceText = JSON.stringify([{ page: 1, text: "Old cached native text." }]);
    row.sourceDigest = digest;
    const result = await preparePdfSource(target, steps().step, guard, dependencies());
    expect(result.source!.text).toBe(row.sourceText);
    expect(load).not.toHaveBeenCalled();
    expect(inspect).not.toHaveBeenCalled();
    expect(recognize).not.toHaveBeenCalled();
    expect(row.analysisStatus).toBe("awaiting_ai");
    row.analysisStatus = "ready";
    await preparePdfSource(target, steps().step, guard, dependencies());
    expect(row.analysisStatus).toBe("ready");
  });

  it.each(["cancelled", "expired"])("rechecks %s work before the next OCR page and never publishes a partial cache", async (state) => {
    let ended = false;
    guard.mockImplementation(async () => { if (ended) throw new HttpError(state === "expired" ? 403 : 409, "ENDED", "Synthetic ended work"); });
    const runner = steps(name => { if (name.endsWith("-ocr-1")) ended = true; });
    await expect(preparePdfSource(target, runner.step, guard, dependencies())).rejects.toMatchObject({ code: "ENDED" });
    expect(load).toHaveBeenCalledTimes(1);
    expect(recognize).not.toHaveBeenCalled();
    expect(m.update).not.toHaveBeenCalled();
  });

  it("rejects a source path replaced between durable steps", async () => {
    const runner = steps(name => { if (name.endsWith("-ocr-1")) row.pdfUrl = "papers/newer.pdf"; });
    await expect(preparePdfSource(target, runner.step, guard, dependencies())).rejects.toMatchObject({ code: "SOURCE_CHANGED" });
    expect(recognize).not.toHaveBeenCalled();
    expect(m.update).not.toHaveBeenCalled();
  });

  it("rejects changed bytes at the same source path before OCR", async () => {
    load.mockResolvedValueOnce(pdf).mockResolvedValueOnce(Buffer.from("%PDF-new-bytes"));
    await expect(preparePdfSource(target, steps().step, guard, dependencies())).rejects.toMatchObject({ code: "SOURCE_CHANGED" });
    expect(recognize).not.toHaveBeenCalled();
    expect(m.update).not.toHaveBeenCalled();
  });

  it("preserves a concurrent newer cache instead of overwriting it", async () => {
    const newer = JSON.stringify([{ page: 1, text: "Newer complete text" }]);
    const runner = steps(name => { if (name.endsWith("-cache")) { row.sourceText = newer; row.sourceDigest = "b".repeat(64); } });
    await expect(preparePdfSource(target, runner.step, guard, dependencies())).rejects.toMatchObject({ code: "SOURCE_CHANGED" });
    expect(row.sourceText).toBe(newer);
  });

  it("subtracts download/authority elapsed time from the 50-second page budget", async () => {
    let elapsed = 0;
    load.mockImplementation(async () => { elapsed += 15_000; return pdf; });
    await preparePdfSource(target, steps().step, guard, { ...dependencies(), now: () => elapsed });
    expect(recognize.mock.calls[0][1].timeoutMs).toBe(35_000);
    expect(recognize.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
  });

  it("does not write any pages when a required OCR page fails", async () => {
    recognize.mockRejectedValue(new PaperSourceError("OCR_TIMEOUT"));
    await expect(preparePdfSource(target, steps().step, guard, dependencies())).rejects.toMatchObject({ code: "OCR_TIMEOUT" });
    expect(m.update).not.toHaveBeenCalled();
    expect(row.sourceText).toBeNull();
  });
  it("preserves only an owned source error across the real Inngest StepError serialization boundary", async () => {
    recognize.mockRejectedValue(new PaperSourceError("OCR_TIMEOUT"));
    await expect(preparePdfSource(target, steps(() => {}, true).step, guard, dependencies())).rejects.toMatchObject({ code: "OCR_TIMEOUT" });
    expect(m.update).not.toHaveBeenCalled();
  });
  it("does not trust a native error merely named PaperSourceError", async () => {
    recognize.mockRejectedValue(Object.assign(new Error("Synthetic native internal detail"), { name: "PaperSourceError", code: "OCR_TIMEOUT" }));
    await expect(preparePdfSource(target, steps(() => {}, true).step, guard, dependencies())).rejects.toBeInstanceOf(StepError);
    expect(m.update).not.toHaveBeenCalled();
  });

  it("shares one bounded signal between signing and the streamed download", async () => {
    m.signed.mockResolvedValue("https://synthetic.invalid/pdf");
    const transport = vi.fn().mockImplementation(async () => new Response(pdf));
    vi.stubGlobal("fetch", transport);
    try {
      await preparePdfSource(target, steps().step, guard, { inspect, recognize });
      expect(m.signed).toHaveBeenCalledTimes(2);
      for (let index = 0; index < 2; index++) {
        expect(m.signed.mock.calls[index][2].signal).toBe(transport.mock.calls[index][1].signal);
        expect(transport.mock.calls[index][1].redirect).toBe("error");
      }
    } finally { vi.unstubAllGlobals(); }
  });

  it("rejects a streamed PDF exceeding 20MB even without a Content-Length header", async () => {
    m.signed.mockResolvedValue("https://synthetic.invalid/pdf");
    const stream = new ReadableStream<Uint8Array>({ start(controller) {
      controller.enqueue(new Uint8Array(11 * 1024 * 1024));
      controller.enqueue(new Uint8Array(11 * 1024 * 1024));
      controller.close();
    } });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(stream)));
    try {
      await expect(preparePdfSource(target, steps().step, guard, { inspect, recognize })).rejects.toMatchObject({ code: "INVALID_PDF" });
      expect(inspect).not.toHaveBeenCalled();
      expect(m.update).not.toHaveBeenCalled();
    } finally { vi.unstubAllGlobals(); }
  });

  it("keeps seminar sources team-scoped with a separate 150-page inspection limit", async () => {
    m.presentation.mockResolvedValue({ id: "seminar", teamId: "team", assets: [{ id: "asset", url: "presentations/synthetic.pdf" }] });
    const result = await preparePdfSource({ kind: "presentation", id: "seminar", teamId: "team" }, steps().step, guard, dependencies());
    expect(m.presentation.mock.calls[0][0].where).toEqual({ id: "seminar", teamId: "team" });
    expect(inspect).toHaveBeenCalledWith(pdf, { maxPages: 150 });
    expect(result.assetId).toBe("asset");
    expect(m.update).not.toHaveBeenCalled();
  });

  it("never reads an object for a foreign/missing material", async () => {
    await expect(preparePdfSource({ ...target, teamId: "other-team" }, steps().step, guard, dependencies())).rejects.toMatchObject({ status: 404 });
    expect(load).not.toHaveBeenCalled();
  });
});
