// @vitest-environment node
import { createRequire } from "node:module";
import { join } from "node:path";
import { access } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import config from "../../../next.config";

describe("standalone server OCR assets", () => {
  it("includes the real child dependency closure and both local language assets in the Inngest deployment", async () => {
    const require = createRequire(join(process.cwd(), "package.json"));
    const nft: { nodeFileTrace(paths: string[], options: { base: string }): Promise<{ fileList: Set<string> }> } = require("next/dist/compiled/@vercel/nft");
    const picomatch: (pattern: string) => (path: string) => boolean = require("next/dist/compiled/picomatch");
    const patterns = config.outputFileTracingIncludes!["/api/inngest"].map(pattern => picomatch(pattern.replace(/^\.\//, "")));
    const traced = await nft.nodeFileTrace(["scripts/pdf-ocr-worker.cjs"], { base: process.cwd() });
    const files = [...traced.fileList].map(path => path.replaceAll("\\", "/")).filter(path => path.startsWith("node_modules/") || path === "scripts/pdf-ocr-worker.cjs");
    for (const language of ["eng", "kor"]) {
      files.push(`node_modules/@tesseract.js-data/${language}/package.json`, `node_modules/@tesseract.js-data/${language}/4.0.0_best_int/${language}.traineddata.gz`);
    }
    expect(files.length).toBeGreaterThan(40);
    for (const file of files) {
      await access(join(process.cwd(), file));
      expect(patterns.some(matches => matches(file)), `Missing deployed OCR asset: ${file}`).toBe(true);
    }
  }, 20_000);
});
