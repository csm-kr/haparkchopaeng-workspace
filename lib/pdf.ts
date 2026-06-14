import { PDFDocument } from "pdf-lib";

// PDF 유틸 — 서버 전용. 업로드 시 "30쪽 초과" 제한 판정에 쓴다(라우트가 호출).
// 페이지 수만 필요하므로 렌더링 없이 pdf-lib로 메타만 읽는다(가벼움, Vercel 서버리스 호환).

/** PDF 바이트의 페이지 수를 센다. 손상·암호화 등으로 못 읽으면 throw. */
export async function countPdfPages(
  bytes: ArrayBuffer | Buffer | Uint8Array,
): Promise<number> {
  // pdf-lib는 Node Buffer를 거부한다(Uint8Array 서브클래스지만 내부 검증 실패) → 순수 Uint8Array로 정규화.
  const input =
    bytes instanceof ArrayBuffer ? new Uint8Array(bytes) : Uint8Array.from(bytes);
  const doc = await PDFDocument.load(input, {
    updateMetadata: false,
    ignoreEncryption: true,
  });
  return doc.getPageCount();
}
