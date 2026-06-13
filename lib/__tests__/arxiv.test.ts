import { describe, expect, it } from "vitest";
import { arxivPdfUrl, parseArxivId } from "@/lib/arxiv";

// SSRF 화이트리스트(arxiv.org만) + ID 파싱. 임의 URL을 서버가 fetch하지 않는다.
describe("parseArxivId", () => {
  it("순수 arXiv ID를 받아들인다", () => {
    expect(parseArxivId("2404.02258")).toBe("2404.02258");
    expect(parseArxivId("  2404.02258  ")).toBe("2404.02258");
  });

  it("버전 접미사는 떼고 기본 ID를 돌려준다", () => {
    expect(parseArxivId("2404.02258v2")).toBe("2404.02258");
  });

  it("arxiv.org의 /abs·/pdf URL을 받아들인다", () => {
    expect(parseArxivId("https://arxiv.org/abs/2404.02258")).toBe("2404.02258");
    expect(parseArxivId("https://arxiv.org/pdf/2404.02258")).toBe("2404.02258");
    expect(parseArxivId("https://arxiv.org/pdf/2404.02258.pdf")).toBe(
      "2404.02258",
    );
    expect(parseArxivId("https://www.arxiv.org/abs/2404.02258v3")).toBe(
      "2404.02258",
    );
  });

  it("arxiv.org가 아닌 호스트는 거부한다(SSRF 화이트리스트)", () => {
    expect(parseArxivId("https://evil.com/pdf/2404.02258")).toBeNull();
    // arxiv.org를 사칭한 서브도메인/유사 도메인도 거부.
    expect(parseArxivId("https://arxiv.org.evil.com/abs/2404.02258")).toBeNull();
    expect(parseArxivId("http://169.254.169.254/abs/2404.02258")).toBeNull();
  });

  it("형식이 어긋나면 null", () => {
    expect(parseArxivId("")).toBeNull();
    expect(parseArxivId("not a url")).toBeNull();
    expect(parseArxivId("https://arxiv.org/")).toBeNull();
  });
});

describe("arxivPdfUrl", () => {
  it("arxiv.org PDF 경로를 만든다", () => {
    expect(arxivPdfUrl("2404.02258")).toBe(
      "https://arxiv.org/pdf/2404.02258.pdf",
    );
  });
});
