import { describe, expect, it } from "vitest";
import { resolvePaperSource } from "@/lib/paper-url";

// PDF 소스 해석기 — arXiv + 학술 호스트 화이트리스트(SSRF). 임의 호스트는 서버가 fetch하지 않는다.
// arxiv 로직은 lib/arxiv.ts 재사용(여기선 통합 동작만 검증).

describe("resolvePaperSource — arXiv", () => {
  it("arXiv ID/URL을 arxiv.org PDF로 해석한다", () => {
    expect(resolvePaperSource("2404.02258")).toEqual({
      pdfUrl: "https://arxiv.org/pdf/2404.02258.pdf",
      arxivId: "2404.02258",
      title: "arXiv:2404.02258",
    });
    expect(resolvePaperSource("https://arxiv.org/abs/2404.02258")).toEqual({
      pdfUrl: "https://arxiv.org/pdf/2404.02258.pdf",
      arxivId: "2404.02258",
      title: "arXiv:2404.02258",
    });
  });
});

describe("resolvePaperSource — 학술 화이트리스트", () => {
  it("CVF 직접 PDF는 URL 그대로, 제목은 파일명에서 유도한다", () => {
    const url =
      "https://openaccess.thecvf.com/content/WACV2024/papers/Shastry_Favoring_One_Among_Equals_-_Not_a_Good_Idea_Many-to-One_WACV_2024_paper.pdf";
    expect(resolvePaperSource(url)).toEqual({
      pdfUrl: url,
      arxivId: null,
      title:
        "Shastry_Favoring_One_Among_Equals_-_Not_a_Good_Idea_Many-to-One_WACV_2024_paper",
    });
  });

  it("OpenReview /pdf?id= 는 URL 그대로, 제목은 쿼리값으로 폴백한다", () => {
    const url = "https://openreview.net/pdf?id=hABwZTqsRb";
    expect(resolvePaperSource(url)).toEqual({
      pdfUrl: url,
      arxivId: null,
      title: "hABwZTqsRb",
    });
  });

  it("ACL/PMLR/NeurIPS 호스트도 허용한다", () => {
    for (const url of [
      "https://aclanthology.org/2023.acl-long.1.pdf",
      "https://proceedings.mlr.press/v202/foo23a/foo23a.pdf",
      "https://proceedings.neurips.cc/paper_files/paper/2023/file/abc-Paper.pdf",
    ]) {
      const r = resolvePaperSource(url);
      expect(r?.pdfUrl).toBe(url);
      expect(r?.arxivId).toBeNull();
    }
  });

  it("파일명 공백(%20)은 디코드해서 제목으로 쓴다", () => {
    const url =
      "https://proceedings.mlr.press/v202/foo23a/Deep%20Learning%20Paper.pdf";
    expect(resolvePaperSource(url)?.title).toBe("Deep Learning Paper");
  });
});

describe("resolvePaperSource — SSRF 거부", () => {
  it("화이트리스트 밖 호스트는 거부한다", () => {
    expect(resolvePaperSource("https://evil.com/paper.pdf")).toBeNull();
  });

  it("http(평문)는 거부한다", () => {
    expect(
      resolvePaperSource("http://openaccess.thecvf.com/x/paper.pdf"),
    ).toBeNull();
  });

  it("사설/링크로컬/localhost는 화이트리스트에 없어 거부한다", () => {
    expect(
      resolvePaperSource("http://169.254.169.254/latest/meta-data"),
    ).toBeNull();
    expect(resolvePaperSource("https://10.0.0.5/paper.pdf")).toBeNull();
    expect(resolvePaperSource("http://localhost/paper.pdf")).toBeNull();
  });

  it("사칭 서브도메인/유사 도메인은 거부한다", () => {
    expect(
      resolvePaperSource("https://openaccess.thecvf.com.evil.com/paper.pdf"),
    ).toBeNull();
  });

  it("빈 입력·비URL은 거부한다", () => {
    expect(resolvePaperSource("")).toBeNull();
    expect(resolvePaperSource("   ")).toBeNull();
    expect(resolvePaperSource("not a url")).toBeNull();
  });
});
