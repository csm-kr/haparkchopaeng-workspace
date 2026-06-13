import { randomUUID } from "node:crypto";
import { z } from "zod";
import { requireAuth } from "@/lib/auth";
import { fail, ok, toErrorResponse } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { arxivPdfUrl, parseArxivId } from "@/lib/arxiv";
import { uploadPdf } from "@/lib/storage";
import { inngest } from "@/lib/inngest";

// POST /api/papers — PDF 업로드(프리사인 경로) 또는 arXiv URL로 Paper 생성.
// CRITICAL: 업로드는 PDF 전용(R12/ADR-003) — 그 외 415.
// CRITICAL: 업로드 성공 ≠ 분석 성공(R28). analysisStatus="pending"으로 두고, 분석은
//   요청 경로에서 인라인 실행하지 않는다 — 다음 step의 잡이 처리한다(ADR-013→016).
// CRITICAL: 업로더(uploadedBy)는 세션에서 취한다 — 클라 입력 미신뢰(R3).
// CRITICAL: arXiv fetch는 arxiv.org 화이트리스트(SSRF) — parseArxivId가 호스트를 강제한다.

const FileBody = z.object({
  objectPath: z.string().min(1),
  filename: z.string().min(1),
});
const ArxivBody = z.object({ arxivUrl: z.string().min(1) });

function hasKey(body: unknown, key: string): boolean {
  return typeof body === "object" && body !== null && key in body;
}

// 분석은 요청 경로가 아니라 Inngest 잡에서 실행한다(R31/ADR-013→016). 잡 적재만 하고 즉시 응답.
// 이벤트 전송 실패가 업로드(Paper 생성)를 막지 않게 삼킨다 — 업로드≠분석(R28). 분석은 reanalyze로 재시도.
async function triggerAnalysis(paperId: string): Promise<void> {
  try {
    await inngest.send({ name: "paper/analyze", data: { paperId } });
  } catch (e) {
    console.error("paper/analyze 이벤트 전송 실패", e);
  }
}

export async function POST(req: Request): Promise<Response> {
  try {
    const session = await requireAuth();
    const body: unknown = await req.json().catch(() => null);

    // --- arXiv 경로: 서버가 arxiv.org PDF를 가져와 스토리지에 저장 ---
    if (hasKey(body, "arxivUrl")) {
      const parsed = ArxivBody.safeParse(body);
      if (!parsed.success) {
        return fail(400, "BAD_REQUEST", "arXiv 주소를 확인해주세요.");
      }
      const id = parseArxivId(parsed.data.arxivUrl);
      if (!id) return fail(400, "BAD_REQUEST", "arXiv 주소를 확인해주세요.");

      // SSRF: parseArxivId가 arxiv.org만 통과시켰으므로 여기서 fetch는 arxiv.org에 한정된다.
      const res = await fetch(arxivPdfUrl(id));
      if (!res.ok) {
        return fail(502, "BAD_GATEWAY", "arXiv에서 PDF를 가져오지 못했어요.");
      }
      const contentType = res.headers.get("content-type") ?? "";
      if (!contentType.includes("application/pdf")) {
        return fail(415, "UNSUPPORTED_MEDIA_TYPE", "PDF만 올릴 수 있어요.");
      }

      const path = `papers/${randomUUID()}.pdf`;
      await uploadPdf(path, await res.arrayBuffer());
      const paper = await prisma.paper.create({
        data: {
          title: `arXiv:${id}`,
          authors: "",
          arxiv: id,
          pdfUrl: path,
          uploadedBy: session.memberId,
          analysisStatus: "pending",
          tags: [],
        },
      });
      await triggerAnalysis(paper.id);
      return ok({ id: paper.id, analysisStatus: paper.analysisStatus }, 201);
    }

    // --- 파일 경로: 프리사인으로 이미 스토리지에 올라간 객체 키를 받는다 ---
    const parsed = FileBody.safeParse(body);
    if (!parsed.success) {
      return fail(400, "BAD_REQUEST", "업로드 정보를 확인해주세요.");
    }
    if (
      !parsed.data.objectPath.toLowerCase().endsWith(".pdf") ||
      !parsed.data.filename.toLowerCase().endsWith(".pdf")
    ) {
      return fail(415, "UNSUPPORTED_MEDIA_TYPE", "PDF만 올릴 수 있어요.");
    }

    // 제목은 파일명에서 유도 — 실제 메타는 분석 잡이 채운다(pending).
    const title = parsed.data.filename.replace(/\.pdf$/i, "");
    const paper = await prisma.paper.create({
      data: {
        title,
        authors: "",
        pdfUrl: parsed.data.objectPath,
        uploadedBy: session.memberId,
        analysisStatus: "pending",
        tags: [],
      },
    });
    await triggerAnalysis(paper.id);
    return ok({ id: paper.id, analysisStatus: paper.analysisStatus }, 201);
  } catch (e) {
    return toErrorResponse(e);
  }
}
