import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { lstat, mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { MAX_PDF_BYTES, MAX_SOURCE_CHARACTERS, PaperSourceError } from "./source";

const MAX_PIXELS = 8_000_000, MAX_PNG_BYTES = 16 * 1024 * 1024, MAX_OUTPUT_BYTES = 1024 * 1024;
const FAILURE_CODES = ["OCR_UNAVAILABLE", "OCR_FAILED", "OCR_TIMEOUT", "OCR_CANCELLED", "TEXT_LIMIT", "RENDER_LIMIT"] as const;
export interface RecognizePdfPageOptions { page: number; maxPages?: number; expectedDigest: string; timeoutMs?: number; signal?: AbortSignal }

/** This child needs the operating system, not the application's credentials or Node customization. */
function ocrEnvironment(): NodeJS.ProcessEnv {
  const allowed = new Set(["SYSTEMROOT", "WINDIR", "COMSPEC", "PATH", "PATHEXT", "TEMP", "TMP", "TMPDIR", "LANG", "LC_ALL"]);
  return { ...Object.fromEntries(Object.entries(process.env).filter(([key]) => allowed.has(key.toUpperCase()))), NODE_ENV: "production" };
}

/** One server-owned page, one bounded child. No arbitrary paths, URLs, network fallback or model calls. */
export async function recognizePdfPage(pdf: Buffer, { page: pageNumber, maxPages = 30, expectedDigest, timeoutMs = 40_000, signal }: RecognizePdfPageOptions): Promise<string> {
  const started = Date.now();
  if (signal?.aborted) throw new PaperSourceError("OCR_CANCELLED");
  if (!Buffer.isBuffer(pdf) || pdf.length > MAX_PDF_BYTES || pdf.subarray(0, 5).toString() !== "%PDF-" ||
      !Number.isInteger(maxPages) || maxPages < 1 || maxPages > 150 || !Number.isInteger(pageNumber) || pageNumber < 1 || pageNumber > maxPages ||
      !Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 40_000) throw new PaperSourceError("INVALID_PDF");
  if (!/^[a-f0-9]{64}$/.test(expectedDigest) || createHash("sha256").update(pdf).digest("hex") !== expectedDigest) throw new PaperSourceError("SOURCE_CHANGED");
  let png: Buffer;
  try {
    const mupdf = await import("mupdf"), document = mupdf.Document.openDocument(pdf, "application/pdf");
    try {
      const count = document.countPages();
      if (count < 1 || count > maxPages) throw new PaperSourceError(maxPages === 30 ? "PAGE_LIMIT" : "SEMINAR_PAGE_LIMIT");
      if (pageNumber > count) throw new PaperSourceError("INVALID_CACHE");
      const page = document.loadPage(pageNumber - 1);
      try {
        const [x0, y0, x1, y1] = page.getBounds(), width = x1 - x0, height = y1 - y0;
        if (![width, height].every(value => Number.isFinite(value) && value > 0 && value <= 14_400)) throw new PaperSourceError("RENDER_LIMIT");
        const scale = Math.min(150 / 72, 4096 / width, 4096 / height, Math.sqrt(MAX_PIXELS / (width * height)));
        const pixmap = page.toPixmap(mupdf.Matrix.scale(scale, scale), mupdf.ColorSpace.DeviceRGB, false);
        try {
          if (pixmap.getWidth() * pixmap.getHeight() > MAX_PIXELS) throw new PaperSourceError("RENDER_LIMIT");
          png = Buffer.from(pixmap.asPNG());
        } finally { pixmap.destroy(); }
      } finally { page.destroy(); }
    } finally { document.destroy(); }
  } catch (error) { throw error instanceof PaperSourceError ? error : new PaperSourceError("UNREADABLE_PDF"); }
  if (png.length > MAX_PNG_BYTES) throw new PaperSourceError("RENDER_LIMIT");
  const remaining = timeoutMs - (Date.now() - started);
  if (remaining <= 0) throw new PaperSourceError("OCR_TIMEOUT");
  if (signal?.aborted) throw new PaperSourceError("OCR_CANCELLED");

  let temporaryRoot: string, owned: string;
  try {
    temporaryRoot = await realpath(tmpdir());
    owned = await mkdtemp(join(temporaryRoot, "hapark-pdf-ocr-"));
  } catch { throw new PaperSourceError("OCR_UNAVAILABLE"); }
  let cleanupAllowed = true;
  try { return await new Promise<string>((resolve, reject) => {
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(process.execPath, [join(process.cwd(), "scripts", "pdf-ocr-worker.cjs")], {
        cwd: owned, env: ocrEnvironment(), windowsHide: true, shell: false, stdio: ["pipe", "pipe", "pipe"],
      });
      cleanupAllowed = false;
    } catch { reject(new PaperSourceError("OCR_UNAVAILABLE")); return; }
    let failure: PaperSourceError | undefined, outputSize = 0, finished = false;
    const output: Buffer[] = [];
    let cleanupTimer: ReturnType<typeof setTimeout> | undefined, abandonTimer: ReturnType<typeof setTimeout> | undefined;
    const clean = () => { clearTimeout(timer); clearTimeout(cleanupTimer); clearTimeout(abandonTimer); signal?.removeEventListener("abort", abort); };
    const stop = (code: typeof FAILURE_CODES[number]) => {
      if (finished || failure) return;
      failure = new PaperSourceError(code);
      // Use the original child handle. Never resolve another process by a numeric PID.
      try { child.kill("SIGTERM"); } catch { /* Wait for close or the bounded cleanup deadline. */ }
      cleanupTimer = setTimeout(() => {
        if (finished) return;
        try { child.kill("SIGKILL"); } catch { /* An unconfirmed process never becomes success. */ }
        abandonTimer = setTimeout(() => {
          if (finished) return;
          finished = true; clean(); child.stdin?.destroy(); child.stdout?.destroy(); child.stderr?.destroy(); child.unref();
          reject(new PaperSourceError("OCR_FAILED"));
        }, 1000);
      }, 1000);
    };
    const abort = () => stop("OCR_CANCELLED");
    const timer = setTimeout(() => stop("OCR_TIMEOUT"), remaining);
    signal?.addEventListener("abort", abort, { once: true });
    child.stderr?.on("data", () => {});
    child.stdout?.on("data", (part: Buffer) => {
      if (failure) return;
      outputSize += part.length;
      if (outputSize > MAX_OUTPUT_BYTES) { stop("TEXT_LIMIT"); return; }
      output.push(Buffer.from(part));
    });
    child.stdin?.on("error", () => stop("OCR_FAILED"));
    child.once("error", () => stop("OCR_UNAVAILABLE"));
    child.once("close", (code, exitSignal) => {
      cleanupAllowed = true;
      if (finished) return;
      finished = true; clean();
      if (failure) { reject(failure); return; }
      try {
        const result: unknown = JSON.parse(Buffer.concat(output).toString("utf8"));
        if (result && typeof result === "object" && "error" in result) {
          const known = FAILURE_CODES.find(value => value === result.error);
          throw new PaperSourceError(known ?? "OCR_FAILED");
        }
        if (code !== 0 || exitSignal || !result || typeof result !== "object" || !("text" in result) || typeof result.text !== "string" ||
            !("confidence" in result) || typeof result.confidence !== "number" || !Number.isFinite(result.confidence) || result.confidence < 0 || result.confidence > 100 ||
            Object.keys(result).some(key => !["text", "confidence"].includes(key))) throw new PaperSourceError("OCR_FAILED");
        if (result.text.length > MAX_SOURCE_CHARACTERS) throw new PaperSourceError("TEXT_LIMIT");
        resolve(result.text.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "").trim());
      } catch (error) { reject(error instanceof PaperSourceError ? error : new PaperSourceError("OCR_FAILED")); }
    });
    if (signal?.aborted) abort();
    try { if (!failure) child.stdin?.end(png); } catch { stop("OCR_FAILED"); }
  }); } finally {
    // Never remove the working directory of a child whose termination was not observed.
    if (cleanupAllowed) {
      try {
        if (dirname(owned) !== temporaryRoot || !basename(owned).startsWith("hapark-pdf-ocr-") ||
            (await lstat(owned)).isSymbolicLink() || await realpath(owned) !== owned) throw new Error();
        await rm(owned, { recursive: true });
      } catch { throw new PaperSourceError("OCR_FAILED"); }
    }
  }
}
