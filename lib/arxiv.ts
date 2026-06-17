// arXiv URL/ID 파싱 + arxiv.org 호스트 강제 (순수 함수, 서버에서 사용).
// CRITICAL: 이 모듈은 arxiv.org만 통과시킨다(SSRF, SECURITY §SSRF, I-10).
// arXiv 외 학술 호스트 화이트리스트는 lib/paper-url.ts의 resolvePaperSource가 담당(이 모듈을 재사용).

const ARXIV_ID = /^\d{4}\.\d{4,5}(?:v\d+)?$/;
const ALLOWED_HOSTS = new Set(["arxiv.org", "www.arxiv.org"]);

/** 입력에서 표준 arXiv ID를 추출한다. arxiv.org 호스트만 허용. 형식이 어긋나면 null. */
export function parseArxivId(input: string): string | null {
  const raw = input.trim();
  if (!raw) return null;

  // 순수 ID 형태(예: 2404.02258 / 2404.02258v2) — 버전은 떼고 기본 ID.
  if (ARXIV_ID.test(raw)) return raw.replace(/v\d+$/, "");

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }

  // 호스트 화이트리스트: arxiv.org / www.arxiv.org 만(서브도메인 사칭·내부 IP 차단).
  if (!ALLOWED_HOSTS.has(url.hostname.toLowerCase())) return null;

  // /abs/<id>, /pdf/<id>, /pdf/<id>.pdf (버전 접미사 허용)
  const m = url.pathname.match(/\/(?:abs|pdf)\/(\d{4}\.\d{4,5})(?:v\d+)?(?:\.pdf)?$/);
  return m ? m[1] : null;
}

/** 표준 ID로 arxiv.org PDF URL을 만든다. */
export function arxivPdfUrl(id: string): string {
  return `https://arxiv.org/pdf/${id}.pdf`;
}
