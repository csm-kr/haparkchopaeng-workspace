import { randomUUID } from "node:crypto";
import { z } from "zod";
import { requireAuth } from "@/lib/auth";
import { fail, ok, toErrorResponse } from "@/lib/http";
import { createSignedUploadUrl, ensureBucket } from "@/lib/storage";

// POST /api/uploads/presign — 프리사인 직접 업로드 URL 발급.
// CRITICAL: 큰 파일은 클라이언트→스토리지 직접 업로드, 서버는 서명만(R36).
// 논문(기본)은 PDF 전용(R12/ADR-003). 발표 자료(kind=presentation)는 슬라이드 파일이라 PDF·PPTX 허용.
// NEWS 티저(kind=news)는 이미지 전용 — news/ 접두로만 발급(ADR-022, R36).
// CRITICAL: 객체 키(경로)는 서버가 정한다 — 클라가 임의 경로를 지정하지 못한다.

const NEWS_IMAGE_EXTS = ["png", "jpg", "jpeg", "webp"];

const Body = z.object({
  filename: z.string().min(1),
  kind: z.enum(["paper", "presentation", "news"]).optional(),
});

export async function POST(req: Request): Promise<Response> {
  try {
    await requireAuth();
    const body: unknown = await req.json().catch(() => null);
    const parsed = Body.safeParse(body);
    if (!parsed.success) {
      return fail(400, "BAD_REQUEST", "파일 이름을 확인해주세요.");
    }

    const kind = parsed.data.kind ?? "paper";
    const name = parsed.data.filename.toLowerCase();

    // NEWS 티저는 이미지 전용 — news/ 접두로만 발급(원본 확장자 유지).
    if (kind === "news") {
      const ext = name.split(".").pop() ?? "";
      if (!NEWS_IMAGE_EXTS.includes(ext)) {
        return fail(415, "UNSUPPORTED_MEDIA_TYPE", "이미지 파일만 올릴 수 있어요.");
      }
      await ensureBucket();
      const path = `news/${randomUUID()}.${ext}`;
      const { uploadUrl } = await createSignedUploadUrl(path);
      return ok({ uploadUrl, path });
    }

    if (kind === "presentation") {
      if (!name.endsWith(".pdf") && !name.endsWith(".pptx")) {
        return fail(415, "UNSUPPORTED_MEDIA_TYPE", "PDF 또는 PPTX만 올릴 수 있어요.");
      }
    } else if (!name.endsWith(".pdf")) {
      return fail(415, "UNSUPPORTED_MEDIA_TYPE", "PDF만 올릴 수 있어요.");
    }

    await ensureBucket();
    const prefix = kind === "presentation" ? "presentations" : "papers";
    const ext = name.endsWith(".pptx") ? "pptx" : "pdf";
    const path = `${prefix}/${randomUUID()}.${ext}`;
    const { uploadUrl } = await createSignedUploadUrl(path);
    return ok({ uploadUrl, path });
  } catch (e) {
    return toErrorResponse(e);
  }
}
