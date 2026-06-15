import { z } from "zod";
import { requireAuth } from "@/lib/auth";
import { getActiveTeam } from "@/lib/active-team";
import { fail, ok, toErrorResponse } from "@/lib/http";
import { prisma } from "@/lib/prisma";

// POST /api/presentations — 발표 자료 생성.
// CRITICAL: teamId는 활성 팀에서, 발표자(presenterId)는 세션에서 취한다 — 클라 입력 미신뢰(R3/R37).
// CRITICAL: 슬라이드 파일은 프리사인으로 이미 스토리지에 올라간 객체 키만 받는다(R36).
//   객체 키는 presentations/ 접두만 허용해 임의 경로 참조를 막는다.
// 슬라이드 본문/요약/키포인트는 비워 둔다 — 추후 편집/분석이 채운다(업로드≠분석, R28).

const AssetInput = z.object({
  // 프리사인이 발급한 presentations/ 키만 신뢰한다(다른 객체 참조 방지).
  objectPath: z.string().regex(/^presentations\//),
  filename: z.string().min(1),
  size: z.string().min(1),
});

const Body = z.object({
  title: z.string().trim().min(1),
  duration: z.string().trim().min(1).optional(),
  asset: AssetInput.optional(),
});

/** 첨부 파일 확장자로 자료 타입을 정한다(pptx → ppt, 그 외 → pdf). */
function assetType(filename: string): "pdf" | "ppt" {
  return filename.toLowerCase().endsWith(".pptx") ? "ppt" : "pdf";
}

export async function POST(req: Request): Promise<Response> {
  try {
    const session = await requireAuth();

    // 활성 팀(검증된 멤버십)에서 teamId를 취한다 — 클라 입력 미신뢰(R3/R37). 없으면 403.
    const team = await getActiveTeam(session.memberId);
    if (!team) return fail(403, "FORBIDDEN", "활성 팀이 없어요.");

    const body: unknown = await req.json().catch(() => null);
    const parsed = Body.safeParse(body);
    if (!parsed.success) {
      return fail(400, "BAD_REQUEST", "발표 제목을 입력해주세요.");
    }
    const { title, duration, asset } = parsed.data;

    const pres = await prisma.presentation.create({
      data: {
        title,
        teamId: team.id, // R3/R37: 활성 팀에서 주입
        presenterId: session.memberId,
        date: new Date(),
        duration: duration ?? null,
        slideCount: 0,
        tags: [],
        summary: null,
        keypoints: [],
        slides: [],
        assets: asset
          ? {
              create: {
                name: asset.filename,
                type: assetType(asset.filename),
                size: asset.size,
                url: asset.objectPath,
              },
            }
          : undefined,
      },
      select: { id: true },
    });

    return ok({ id: pres.id }, 201);
  } catch (e) {
    return toErrorResponse(e);
  }
}
