import { requireAuth } from "@/lib/auth";
import { fail, toErrorResponse } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { signedDownloadUrl, downloadObject, assertGeneratedPresentationStorage } from "@/lib/storage";
import { getActiveTeam } from "@/lib/active-team";

// GET /api/presentations/:id/assets/:assetId — 첨부 자료 다운로드.
// CRITICAL: 비공개 버킷 + 단기 서명 URL로 리디렉트(R36). 영구/공개 URL 노출 금지.
// 저장된 url은 스토리지 객체 키(presentations/…)다 — 매 요청마다 새로 서명한다.

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string; assetId: string }> },
): Promise<Response> {
  try {
    const session = await requireAuth();
    const { id, assetId } = await params;
    const team = await getActiveTeam(session.memberId);
    if (!team) return fail(403,"FORBIDDEN","현재 팀의 자료를 찾을 수 없어요.");

    const asset = await prisma.presentationAsset.findFirst({
      where: { id: assetId, presentationId: id, presentation: { teamId: team.id } },
      select: { url: true, type: true, name: true },
    });
    if (!asset) return fail(404, "NOT_FOUND", "자료를 찾을 수 없어요.");

    if (asset.type === "html") {
      assertGeneratedPresentationStorage();
      return new Response(new Uint8Array(await downloadObject(asset.url)),{ headers: { "Content-Type": "text/html; charset=utf-8", "Content-Disposition": `attachment; filename="seminar.html"; filename*=UTF-8''${encodeURIComponent(asset.name)}`, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "sandbox; default-src 'none'" } });
    }
    const url = await signedDownloadUrl(asset.url, 60);
    return Response.redirect(url, 302);
  } catch (e) {
    return toErrorResponse(e);
  }
}
