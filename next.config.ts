import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // 서버 전용 네이티브/wasm 모듈은 번들에서 제외하고 런타임에 node_modules에서 로드한다.
  // figure 추출 파이프라인이 mupdf(wasm PDF 렌더러)·sharp(네이티브 이미지)를 쓴다.
  serverExternalPackages: ["mupdf", "sharp", "tesseract.js", "tesseract.js-core", "@tesseract.js-data/eng", "@tesseract.js-data/kor"],
  // sharp의 libvips(.so)는 런타임 dlopen으로 로드돼 @vercel/nft가 추적하지 못한다 →
  // Lambda에 누락되면 ERR_DLOPEN_FAILED로 /api/inngest가 500. 분석 잡 라우트에
  // Linux 네이티브 바이너리를 강제 포함한다(Vercel runtime은 linux-x64).
  outputFileTracingIncludes: {
    "/api/inngest": [
      "./public/fonts/Pretendard-Regular.ttf",
      "./public/fonts/Pretendard-SemiBold.ttf",
      "./public/fonts/Pretendard-LICENSE.txt",
      "./node_modules/@img/sharp-linux-x64/**/*",
      "./node_modules/@img/sharp-libvips-linux-x64/**/*",
      "./node_modules/mupdf/dist/mupdf-wasm.wasm",
      "./scripts/pdf-ocr-worker.cjs",
      "./node_modules/tesseract.js/src/**/*",
      "./node_modules/tesseract.js/package.json",
      "./node_modules/tesseract.js/node_modules/**/*",
      "./node_modules/tesseract.js-core/**/*",
      "./node_modules/bmp-js/**/*",
      "./node_modules/is-url/**/*",
      "./node_modules/regenerator-runtime/**/*",
      "./node_modules/wasm-feature-detect/**/*",
      "./node_modules/@tesseract.js-data/eng/package.json",
      "./node_modules/@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz",
      "./node_modules/@tesseract.js-data/kor/package.json",
      "./node_modules/@tesseract.js-data/kor/4.0.0_best_int/kor.traineddata.gz",
    ],
  },
};

export default nextConfig;
