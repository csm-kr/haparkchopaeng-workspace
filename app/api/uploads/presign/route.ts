import { randomUUID } from "node:crypto";
import { z } from "zod";
import { requireAuth } from "@/lib/auth";
import { fail, ok, toErrorResponse } from "@/lib/http";
import { createSignedUploadUrl, ensureBucket } from "@/lib/storage";

// POST /api/uploads/presign — 프리사인 직접 업로드 URL 발급(PDF만).
// CRITICAL: 큰 PDF는 클라이언트→스토리지 직접 업로드, 서버는 서명만(R36).
// CRITICAL: PDF 전용 — 그 외 415(R12/ADR-003).

const Body = z.object({ filename: z.string().min(1) });

export async function POST(req: Request): Promise<Response> {
  try {
    await requireAuth();
    const body: unknown = await req.json().catch(() => null);
    const parsed = Body.safeParse(body);
    if (!parsed.success) {
      return fail(400, "BAD_REQUEST", "파일 이름을 확인해주세요.");
    }
    if (!parsed.data.filename.toLowerCase().endsWith(".pdf")) {
      return fail(415, "UNSUPPORTED_MEDIA_TYPE", "PDF만 올릴 수 있어요.");
    }

    await ensureBucket();
    // 객체 키는 서버가 정한다 — 클라가 임의 경로를 지정하지 못한다.
    const path = `papers/${randomUUID()}.pdf`;
    const { uploadUrl } = await createSignedUploadUrl(path);
    return ok({ uploadUrl, path });
  } catch (e) {
    return toErrorResponse(e);
  }
}
