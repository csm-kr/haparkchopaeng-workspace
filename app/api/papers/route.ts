import { randomUUID } from "node:crypto";
import { z } from "zod";
import { requireAuth } from "@/lib/auth";
import { getActiveTeam } from "@/lib/active-team";
import { fail, HttpError, ok, toErrorResponse } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { arxivPdfUrl, parseArxivId } from "@/lib/arxiv";
import { removeObject, signedDownloadUrl, uploadPdf } from "@/lib/storage";
import { isPaperQuotaExceeded, paperWeeklyLimit } from "@/lib/rate-limit";
import { countPdfPages } from "@/lib/pdf";
import { inngest } from "@/lib/inngest";

// POST /api/papers — PDF 업로드(프리사인 경로) 또는 arXiv URL로 Paper 생성.
// CRITICAL: 업로드는 PDF 전용(R12/ADR-003) — 그 외 415.
// CRITICAL: 업로드 성공 ≠ 분석 성공(R28). analysisStatus="pending"으로 두고, 분석은
//   요청 경로에서 인라인 실행하지 않는다 — 다음 step의 잡이 처리한다(ADR-013→016).
// CRITICAL: 업로더(uploadedBy)는 세션에서 취한다 — 클라 입력 미신뢰(R3).
// CRITICAL: arXiv fetch는 arxiv.org 화이트리스트(SSRF) — parseArxivId가 호스트를 강제한다.
// 비용 가드: ① 주간 업로드 한도(인당, Gemini 비용 통제, lib/rate-limit) ② 30쪽 초과 PDF 거부.

const MAX_PAGES = 30; // 30쪽 초과 PDF는 받지 않는다(분석 비용·토큰 상한).

const FileBody = z.object({
  objectPath: z.string().min(1),
  filename: z.string().min(1),
});
const ArxivBody = z.object({ arxivUrl: z.string().min(1) });

function hasKey(body: unknown, key: string): boolean {
  return typeof body === "object" && body !== null && key in body;
}

/** PDF 페이지 수 제한(≤30쪽). 초과/판독불가면 HttpError를 던진다(toErrorResponse가 응답으로 변환). */
async function assertPageLimit(bytes: ArrayBuffer): Promise<number> {
  let pages: number;
  try {
    pages = await countPdfPages(bytes);
  } catch {
    throw new HttpError(
      400,
      "BAD_REQUEST",
      "PDF를 읽을 수 없어요. 다른 파일로 시도해주세요.",
    );
  }
  if (pages > MAX_PAGES) {
    throw new HttpError(
      413,
      "PDF_TOO_LONG",
      `30쪽 이하 PDF만 올릴 수 있어요. (지금 ${pages}쪽)`,
    );
  }
  return pages;
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

    // 활성 팀(검증된 멤버십)에서 teamId를 취한다 — 클라 입력 미신뢰(R3/R37). 없으면 403.
    const team = await getActiveTeam(session.memberId);
    if (!team) return fail(403, "FORBIDDEN", "활성 팀이 없어요.");

    // 주간 업로드 한도(인당) — Gemini 비용 통제. 초과면 429(어느 경로든 생성 전에 차단).
    if (await isPaperQuotaExceeded(session.memberId)) {
      return fail(
        429,
        "TOO_MANY_REQUESTS",
        `이번 주 분석 한도(${paperWeeklyLimit()}편)를 다 썼어요. 다음 주에 다시 올려주세요.`,
      );
    }

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

      // 30쪽 제한: 업로드/생성 전에 페이지 수를 확인한다(초과면 throw → 저장하지 않음).
      const bytes = await res.arrayBuffer();
      const pageCount = await assertPageLimit(bytes);

      const path = `papers/${randomUUID()}.pdf`;
      await uploadPdf(path, bytes);
      const paper = await prisma.paper.create({
        data: {
          title: `arXiv:${id}`,
          authors: "",
          arxiv: id,
          pageCount,
          pdfUrl: path,
          teamId: team.id, // R3/R37: 활성 팀에서 주입
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

    // 30쪽 제한: 이미 스토리지에 올라간 객체(프리사인 업로드)를 내려받아 페이지 수를 확인한다.
    const url = await signedDownloadUrl(parsed.data.objectPath, 120);
    const dl = await fetch(url);
    if (!dl.ok) {
      return fail(502, "BAD_GATEWAY", "업로드한 파일을 확인하지 못했어요.");
    }
    const bytes = await dl.arrayBuffer();
    let pageCount: number;
    try {
      pageCount = await assertPageLimit(bytes);
    } catch (e) {
      // 한도 위반(또는 판독 불가) 업로드는 고아 객체로 남지 않게 정리한다(best-effort).
      await removeObject(parsed.data.objectPath);
      throw e;
    }

    // 제목은 파일명에서 유도 — 실제 메타는 분석 잡이 채운다(pending).
    const title = parsed.data.filename.replace(/\.pdf$/i, "");
    const paper = await prisma.paper.create({
      data: {
        title,
        authors: "",
        pageCount,
        pdfUrl: parsed.data.objectPath,
        teamId: team.id, // R3/R37: 활성 팀에서 주입
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
