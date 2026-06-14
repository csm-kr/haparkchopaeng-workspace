import { requireAuth } from "@/lib/auth";
import { fail, toErrorResponse } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { signedDownloadUrl } from "@/lib/storage";

// GET /api/figures/:id/image — figure 이미지 다운로드.
// CRITICAL: 비공개 버킷 + 단기 서명 URL로 리디렉트(R36). DB엔 경로만 저장하고 여기서 서명한다.
// imageUrl이 아직 없으면(렌더 전/실패) 404 — 화면은 "이미지 없음" UI로 대체된다.
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    await requireAuth();
    const { id } = await params;

    const figure = await prisma.figure.findUnique({
      where: { id },
      select: { imageUrl: true },
    });
    if (!figure?.imageUrl) return fail(404, "NOT_FOUND", "이미지를 찾을 수 없어요.");

    const url = await signedDownloadUrl(figure.imageUrl, 60);
    return Response.redirect(url, 302);
  } catch (e) {
    return toErrorResponse(e);
  }
}
