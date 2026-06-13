import { requireAuth } from "@/lib/auth";
import { ok, toErrorResponse } from "@/lib/http";
import { prisma } from "@/lib/prisma";

// GET /api/members — 멤버 목록(🔒 인증 필요).
export async function GET(): Promise<Response> {
  try {
    await requireAuth();
    const members = await prisma.member.findMany({ orderBy: { createdAt: "asc" } });
    return ok(members);
  } catch (e) {
    return toErrorResponse(e);
  }
}
