import { z } from "zod";
import { requireAuth } from "@/lib/auth";
import { fail, ok, toErrorResponse } from "@/lib/http";
import { prisma } from "@/lib/prisma";

// GET /api/me — 현재 멤버. PATCH /api/me — 본인 프로필 수정.
// CRITICAL: 대상 id는 세션에서 취한다 — 클라이언트가 보낸 id를 신뢰하지 않는다(R3).

export async function GET(): Promise<Response> {
  try {
    const session = await requireAuth();
    const member = await prisma.member.findUnique({ where: { id: session.memberId } });
    if (!member) return fail(401, "UNAUTHORIZED", "로그인이 필요해요.");
    return ok(member);
  } catch (e) {
    return toErrorResponse(e);
  }
}

const PatchInput = z
  .object({
    name: z.string().min(1).optional(),
    handle: z.string().min(1).optional(),
    status: z.string().nullable().optional(),
    presence: z.enum(["online", "away", "busy", "offline"]).optional(),
    availability: z.enum(["active", "vacation"]).optional(),
  })
  .strict();

export async function PATCH(req: Request): Promise<Response> {
  try {
    const session = await requireAuth();
    const body: unknown = await req.json().catch(() => null);
    const parsed = PatchInput.safeParse(body);
    if (!parsed.success) return fail(400, "BAD_REQUEST", "내용을 확인해주세요.");

    // handle은 @unique — 다른 멤버가 이미 쓰면 409로 따뜻하게 안내(R30).
    if (parsed.data.handle !== undefined) {
      const taken = await prisma.member.findFirst({
        where: { handle: parsed.data.handle, id: { not: session.memberId } },
        select: { id: true },
      });
      if (taken) return fail(409, "CONFLICT", "이미 사용 중인 핸들이에요.");
    }

    const member = await prisma.member.update({
      where: { id: session.memberId },
      data: parsed.data,
    });
    return ok(member);
  } catch (e) {
    return toErrorResponse(e);
  }
}
