/** Fixed server-only OCR child. Input is PNG bytes, never a path, URL or application credential. */
"use strict";
const { readFileSync, writeFileSync, lstatSync, realpathSync } = require("node:fs");
const { basename, dirname, join } = require("node:path");
const { createHash } = require("node:crypto");
const MAX_BYTES = 16 * 1024 * 1024, MAX_PIXELS = 8_000_000, MAX_TEXT = 120_000;
const LANGUAGES = {
  eng: "45b4cb346724ac1774f1c36f42f182b887bcdb28ebe63e6fff90ac41f3fcff91",
  kor: "78c21276ab14c9bb734d83be1055d9fe5469a4e7e977c51ad385be5737e61126",
};
function language(code) {
  const path = join(dirname(require.resolve(`@tesseract.js-data/${code}/package.json`)), "4.0.0_best_int", `${code}.traineddata.gz`);
  const data = readFileSync(path);
  if (data.length > 4 * 1024 * 1024 || createHash("sha256").update(data).digest("hex") !== LANGUAGES[code]) throw Error("OCR_UNAVAILABLE");
  return { code, data };
}
async function main() {
  let size = 0;
  const parts = [];
  for await (const part of process.stdin) {
    size += part.length;
    if (size > MAX_BYTES) return { error: "RENDER_LIMIT" };
    parts.push(part);
  }
  const image = Buffer.concat(parts);
  if (image.length < 24 || !image.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ||
      image.subarray(12, 16).toString("ascii") !== "IHDR" || !image.readUInt32BE(16) || !image.readUInt32BE(20) ||
      image.readUInt32BE(16) * image.readUInt32BE(20) > MAX_PIXELS) return { error: "OCR_FAILED" };
  let worker, stage = "load";
  try {
    const { createWorker, OEM } = require("tesseract.js");
    const directory = process.cwd();
    if (!basename(directory).startsWith("hapark-pdf-ocr-") || lstatSync(directory).isSymbolicLink() || realpathSync(directory) !== directory) return { error: "OCR_UNAVAILABLE" };
    for (const lang of [language("eng"), language("kor")]) writeFileSync(join(directory, `${lang.code}.traineddata.gz`), lang.data, { flag: "wx", mode: 0o600 });
    // v7's object-language initialization joins .data instead of .code. Fixed local files avoid that bug and all CDN paths.
    worker = await createWorker("eng+kor", OEM.LSTM_ONLY, {
      workerPath: require.resolve("tesseract.js/src/worker-script/node/index.js"),
      langPath: directory,
      cacheMethod: "none", gzip: true, logger: () => {}, errorHandler: () => {},
    });
    stage = "recognize";
    const { data } = await worker.recognize(image, {}, { text: true });
    if (typeof data.text !== "string" || data.text.length > MAX_TEXT) return { error: "TEXT_LIMIT" };
    const confidence = Number(data.confidence);
    if (!Number.isFinite(confidence) || confidence < 0 || confidence > 100) return { error: "OCR_FAILED" };
    return { text: data.text, confidence };
  } catch { return { error: stage === "load" ? "OCR_UNAVAILABLE" : "OCR_FAILED" }; }
  finally { if (worker) await worker.terminate().catch(() => {}); }
}
main().then(result => process.stdout.write(JSON.stringify(result) + "\n", () => process.exit(result.error ? 1 : 0)))
  .catch(() => process.stdout.write('{"error":"OCR_FAILED"}\n', () => process.exit(1)));
