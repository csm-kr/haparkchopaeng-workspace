import { requireAuth } from "@/lib/auth";
import { getActiveTeam } from "@/lib/active-team";
import { prisma } from "@/lib/prisma";
import { fail, toErrorResponse } from "@/lib/http";
import { downloadObject } from "@/lib/storage";
import { countPdfPages, renderPdfPageToPng } from "@/lib/pdf-page-render";

/** One bounded page preview, identical to the existing presentation page rendering boundary. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string; n: string }> }): Promise<Response> {
  try {
    const session = await requireAuth(), { id, n } = await params;
    if (!/^\d+$/.test(n) || !Number.isSafeInteger(Number(n)) || Number(n) < 1 || Number(n) > 300) return fail(400, "BAD_REQUEST", "원문 페이지 번호를 확인해주세요.");
    const team = await getActiveTeam(session.memberId);
    const paper = team ? await prisma.paper.findFirst({ where: { id, teamId: team.id }, select: { pdfUrl: true } }) : null;
    if (!paper?.pdfUrl) return fail(404, "NOT_FOUND", "현재 팀의 원문 PDF를 찾을 수 없어요.");
    const pdf = await downloadObject(paper.pdfUrl);
    if (Number(n) > countPdfPages(pdf)) return fail(404, "NOT_FOUND", "원문에 없는 페이지예요.");
    return new Response(new Uint8Array(renderPdfPageToPng(pdf, Number(n) - 1)), { headers: { "Content-Type": "image/png", "Cache-Control": "private, max-age=300", "X-Content-Type-Options": "nosniff" } });
  } catch (cause) { return toErrorResponse(cause); }
}
