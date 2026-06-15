import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireAuth } from "@/lib/auth";
import { fail, ok, toErrorResponse } from "@/lib/http";
import { setActiveTeam } from "@/lib/active-team";

// POST /api/teams/active — 활성 팀 전환(ADR-020/R37).
// CRITICAL: 활성 팀 전환은 검증된 멤버십만 — slug가 내 멤버십이 아니면 setActiveTeam이 403으로 거부한다(R19).
// 신원(memberId)은 세션에서 취한다(R3). 전환 후 셸/화면을 revalidate한다.

const Schema = z.object({ slug: z.string().min(1) });

export async function POST(req: Request): Promise<Response> {
  try {
    const session = await requireAuth();

    const body: unknown = await req.json().catch(() => null);
    const parsed = Schema.safeParse(body);
    if (!parsed.success) return fail(400, "BAD_REQUEST", "팀을 확인해주세요.");

    await setActiveTeam(session.memberId, parsed.data.slug);
    revalidatePath("/", "layout"); // 활성 팀이 바뀌면 셸(모든 화면)을 다시 그린다
    return ok({ slug: parsed.data.slug });
  } catch (e) {
    return toErrorResponse(e);
  }
}
