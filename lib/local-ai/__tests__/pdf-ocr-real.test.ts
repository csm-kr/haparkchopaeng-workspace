// @vitest-environment node
import { access, readFile } from "node:fs/promises";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ChildProcess, SpawnOptions } from "node:child_process";
const observed = vi.hoisted(() => ({ children: [] as { child: ChildProcess; cwd: string }[] }));
vi.mock("node:child_process", async original => {
  const actual = await original<typeof import("node:child_process")>();
  return { ...actual, spawn: (file: string, args: string[], options: SpawnOptions) => {
    const child = actual.spawn(file, args, options);
    observed.children.push({ child, cwd: String(options.cwd) });
    return child;
  } };
});
import { recognizePdfPage } from "../pdf-ocr";
import { inspectPdfSource, mergePdfSource, parsePaperSource } from "../source";
import { fixturePdf } from "./pdf-fixtures";

afterEach(async () => {
  for (const { child, cwd } of observed.children) {
    expect(child.exitCode !== null || child.signalCode !== null).toBe(true);
    await expect(access(cwd)).rejects.toMatchObject({ code: "ENOENT" });
  }
  observed.children.length = 0;
});

describe("real local OCR of synthetic image-only PDFs", () => {
  it("recognizes a scanned page, retains the other native page and produces canonical citation text", async () => {
    const pdf = await fixturePdf([{ native: "Native research evidence." }, { image: "SCANNED PAPER EVIDENCE" }]);
    const inspected = await inspectPdfSource(pdf);
    expect(inspected.ocrPages).toEqual([2]);
    const text = await recognizePdfPage(pdf, { page: 2, expectedDigest: inspected.digest });
    expect(text).toMatch(/SCANNED PAPER EVIDENCE/i);
    const pages = parsePaperSource(mergePdfSource(inspected, [{ page: 2, text }]).text);
    expect(pages[0]).toEqual({ page: 1, text: "Native research evidence." });
    expect(pages[1]).toMatchObject({ page: 2, method: "ocr" });
    expect(pages[1].text).toContain("EVIDENCE");
  }, 50_000);

  it("keeps a white scanned PDF empty after the actual OCR engine runs", async () => {
    const pdf = await fixturePdf([{ blankImage: true }]), inspected = await inspectPdfSource(pdf);
    const text = await recognizePdfPage(pdf, { page: 1, expectedDigest: inspected.digest });
    expect(text.trim()).toBe("");
    expect(() => mergePdfSource(inspected, [{ page: 1, text }])).toThrowError(expect.objectContaining({ code: "NO_TEXT" }));
  }, 50_000);

  it("reads a real image-only English and Korean page using both pinned local language assets", async () => {
    const imagePng = await readFile(new URL("./fixtures/ocr-eng-kor.png", import.meta.url));
    const pdf = await fixturePdf([{ imagePng }]), inspected = await inspectPdfSource(pdf);
    const text = await recognizePdfPage(pdf, { page: 1, expectedDigest: inspected.digest });
    expect(text).toMatch(/RESEARCH EVIDENCE/i);
    expect(text.replace(/\s/g, "")).toContain("대한민국연구결과");
  }, 50_000);

  it("enforces a tiny explicit deadline without leaking a child or temporary language directory", async () => {
    const pdf = await fixturePdf([{ image: "DEADLINE TEST" }]), inspected = await inspectPdfSource(pdf);
    await expect(recognizePdfPage(pdf, { page: 1, expectedDigest: inspected.digest, timeoutMs: 1 })).rejects.toMatchObject({ code: "OCR_TIMEOUT" });
  }, 5000);
});
