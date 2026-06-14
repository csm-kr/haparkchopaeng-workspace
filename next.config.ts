import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // 서버 전용 네이티브/wasm 모듈은 번들에서 제외하고 런타임에 node_modules에서 로드한다.
  // figure 추출 파이프라인이 mupdf(wasm PDF 렌더러)·sharp(네이티브 이미지)를 쓴다.
  serverExternalPackages: ["mupdf", "sharp"],
};

export default nextConfig;
