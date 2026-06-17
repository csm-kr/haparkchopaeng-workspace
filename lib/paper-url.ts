// PDF 소스 해석기 — arXiv + 학술 호스트 화이트리스트(SSRF, 순수 함수, 서버에서 사용).
// CRITICAL: arXiv 외 임의 URL을 서버가 fetch하지 않는다 — 호스트는 아래 화이트리스트만 허용(SECURITY §파일 스토리지).
// arXiv는 lib/arxiv.ts가 ID 파싱·PDF URL 변환을 담당. 그 외는 입력 URL을 그대로 fetch 대상으로 둔다
// (PDF 여부는 호출 측 route의 Content-Type 검사로 보장).

import { arxivPdfUrl, parseArxivId } from "@/lib/arxiv";

/** arXiv 외에 서버가 PDF를 가져올 수 있는 학술 호스트(정확 일치 — 서브도메인 사칭 차단). */
const ALLOWED_PDF_HOSTS = new Set([
  "openaccess.thecvf.com", // CVF (CVPR/ICCV/WACV)
  "openreview.net", // ICLR/NeurIPS
  "aclanthology.org", // ACL/EMNLP/NAACL
  "proceedings.mlr.press", // PMLR (ICML/AISTATS)
  "proceedings.neurips.cc", // NeurIPS
]);

export interface PaperSource {
  /** 서버가 fetch할 직접 PDF URL */
  pdfUrl: string;
  /** arXiv면 표준 ID, 아니면 null */
  arxivId: string | null;
  /** 생성 시 넣을 플레이스홀더 제목(분석 잡은 제목을 채우지 않는다) */
  title: string;
}

/** URL에서 읽을 만한 제목을 유도한다 — 마지막 경로 세그먼트의 .pdf를 떼고 디코드. 없거나 일반 'pdf'면 쿼리값/호스트. */
function deriveTitle(url: URL): string {
  const seg = url.pathname.split("/").filter(Boolean).pop() ?? "";
  const name = decodeURIComponent(seg).replace(/\.pdf$/i, "");
  if (name && name.toLowerCase() !== "pdf") return name;
  const firstQuery = [...url.searchParams.values()][0];
  return firstQuery || url.hostname;
}

/**
 * 입력(arXiv ID/URL 또는 학술 PDF URL)을 fetch 가능한 PDF 소스로 해석한다.
 * 화이트리스트 밖 호스트·http(평문)·형식 오류는 null — 서버가 fetch하지 않는다(SSRF).
 */
export function resolvePaperSource(input: string): PaperSource | null {
  const raw = input.trim();
  if (!raw) return null;

  // arXiv 우선 — ID 파싱·PDF URL 변환은 arxiv.ts에 위임(기존 동작 불변).
  const arxivId = parseArxivId(raw);
  if (arxivId) {
    return { pdfUrl: arxivPdfUrl(arxivId), arxivId, title: `arXiv:${arxivId}` };
  }

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }

  // https + 호스트 정확 일치만(평문·사설IP·서브도메인 사칭은 화이트리스트 불일치로 거부).
  if (url.protocol !== "https:") return null;
  if (!ALLOWED_PDF_HOSTS.has(url.hostname.toLowerCase())) return null;

  return { pdfUrl: raw, arxivId: null, title: deriveTitle(url) };
}
