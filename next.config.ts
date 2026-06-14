import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // 서버 전용 네이티브/wasm 모듈은 번들에서 제외하고 런타임에 node_modules에서 로드한다.
  // figure 추출 파이프라인이 mupdf(wasm PDF 렌더러)·sharp(네이티브 이미지)를 쓴다.
  serverExternalPackages: ["mupdf", "sharp"],
  // sharp의 libvips(.so)는 런타임 dlopen으로 로드돼 @vercel/nft가 추적하지 못한다 →
  // Lambda에 누락되면 ERR_DLOPEN_FAILED로 /api/inngest가 500. 분석 잡 라우트에
  // Linux 네이티브 바이너리를 강제 포함한다(Vercel runtime은 linux-x64).
  outputFileTracingIncludes: {
    "/api/inngest": [
      "./node_modules/@img/sharp-linux-x64/**/*",
      "./node_modules/@img/sharp-libvips-linux-x64/**/*",
    ],
  },
};

export default nextConfig;
