// @vitest-environment node
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { createHash } from "node:crypto";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ spawn: vi.fn(), realpath: vi.fn(), rm: vi.fn() }));
vi.mock("node:child_process", () => ({ spawn: m.spawn }));
vi.mock("node:fs/promises", async importOriginal => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  m.realpath.mockImplementation(actual.realpath); m.rm.mockImplementation(actual.rm);
  return { ...actual, realpath: m.realpath, rm: m.rm };
});
import { recognizePdfPage } from "../pdf-ocr";
import { sourceFailureMessage } from "../source";
import { fixturePdf } from "./pdf-fixtures";

let pdf: Buffer, digest: string;
beforeAll(async () => { pdf = await fixturePdf([{ image: "SCANNED PAPER EVIDENCE" }]); digest = createHash("sha256").update(pdf).digest("hex"); });
beforeEach(() => { vi.clearAllMocks(); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });
function childProcess() {
  const child = Object.assign(new EventEmitter(), { stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(), kill: vi.fn(), unref: vi.fn() });
  m.spawn.mockReturnValue(child);
  return child;
}
function complete(child: ReturnType<typeof childProcess>, output: unknown, code = 0) { child.stdout.emit("data", Buffer.from(JSON.stringify(output))); child.emit("close", code, null); }

describe("bounded page OCR child", () => {
  it("accepts only the expected PDF and page before starting any child", async () => {
    await expect(recognizePdfPage(pdf, { page: 1, expectedDigest: "a".repeat(64) })).rejects.toMatchObject({ code: "SOURCE_CHANGED" });
    await expect(recognizePdfPage(pdf, { page: 2, expectedDigest: digest })).rejects.toMatchObject({ code: "INVALID_CACHE" });
    expect(m.spawn).not.toHaveBeenCalled();
  });
  it("sends a rendered PNG to a fixed hidden child with no server secrets and completes only after close", async () => {
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "private-fixture"); vi.stubEnv("NODE_OPTIONS", "private-fixture");
    const child = childProcess(), result = recognizePdfPage(pdf, { page: 1, expectedDigest: digest });
    await vi.waitFor(() => expect(m.spawn).toHaveBeenCalledOnce());
    const [command, args, options] = m.spawn.mock.calls[0];
    expect(command).toBe(process.execPath); expect(args).toHaveLength(1); expect(args[0]).toMatch(/scripts[\\/]pdf-ocr-worker\.cjs$/);
    expect(options).toMatchObject({ windowsHide: true, shell: false });
    expect(options.env.SUPABASE_SERVICE_ROLE_KEY).toBeUndefined(); expect(options.env.NODE_OPTIONS).toBeUndefined();
    const image = child.stdin.read() as Buffer;
    expect([...image.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
    child.stdout.emit("data", Buffer.from('{"text":"Recognized evidence","confidence":95}'));
    let resolved = false; void result.then(() => { resolved = true; }); await Promise.resolve(); expect(resolved).toBe(false);
    child.emit("close", 0, null); await expect(result).resolves.toBe("Recognized evidence");
  });
  it("terminates the original child on timeout and rejects only after termination is observed", async () => {
    const child = childProcess();
    const result = recognizePdfPage(pdf, { page: 1, expectedDigest: digest, timeoutMs: 1000 }).catch(error => error);
    await vi.waitFor(() => expect(m.spawn).toHaveBeenCalledOnce());
    await vi.waitFor(() => expect(child.kill).toHaveBeenCalledWith("SIGTERM"), { timeout: 2000 });
    child.emit("close", null, "SIGTERM"); expect(await result).toMatchObject({ code: "OCR_TIMEOUT" });
  });
  it("cancels an owned child and never reflects private stderr or native exception messages", async () => {
    const child = childProcess(), controller = new AbortController();
    const result = recognizePdfPage(pdf, { page: 1, expectedDigest: digest, signal: controller.signal }).catch(error => error);
    await vi.waitFor(() => expect(m.spawn).toHaveBeenCalledOnce());
    child.stderr.emit("data", Buffer.from("private host path and service credential")); controller.abort();
    expect(child.kill).toHaveBeenCalledWith("SIGTERM"); child.emit("close", null, "SIGTERM");
    const error = await result; expect(error.code).toBe("OCR_CANCELLED"); expect(sourceFailureMessage(error)).not.toContain("private");
  });
  it("rejects malformed, oversized and unsuccessful child output with owned errors", async () => {
    for (const output of [{ text: "text", confidence: Number.POSITIVE_INFINITY }, { error: "private host path" }, { text: "x".repeat(120_001), confidence: 90 }]) {
      const child = childProcess(), result = recognizePdfPage(pdf, { page: 1, expectedDigest: digest }).catch(error => error);
      await vi.waitFor(() => expect(m.spawn).toHaveBeenCalled()); complete(child, output);
      expect(["OCR_FAILED", "TEXT_LIMIT"]).toContain((await result).code); m.spawn.mockClear();
    }
  });
  it("does not expose native temporary-directory failures or start a child", async () => {
    m.realpath.mockRejectedValueOnce(new Error("private host path and system identity"));
    const error = await recognizePdfPage(pdf, { page: 1, expectedDigest: digest }).catch(error => error);
    expect(error).toMatchObject({ code: "OCR_UNAVAILABLE" });
    expect(error.message).not.toContain("private"); expect(m.spawn).not.toHaveBeenCalled();
  });
  it("never turns failed cleanup into success or exposes a native path", async () => {
    const actual = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
    const child = childProcess(), result = recognizePdfPage(pdf, { page: 1, expectedDigest: digest }).catch(error => error);
    await vi.waitFor(() => expect(m.spawn).toHaveBeenCalledOnce());
    const owned = m.spawn.mock.calls[0][2].cwd;
    m.rm.mockRejectedValueOnce(new Error("private host path and permission"));
    complete(child, { text: "Recognized evidence", confidence: 95 });
    try {
      const error = await result;
      expect(error).toMatchObject({ code: "OCR_FAILED" }); expect(error.message).not.toContain("private");
    } finally { await actual.rm(owned, { recursive: true }); }
  });
});
