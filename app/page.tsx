import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { sanitizeNext } from "@/lib/redirect";
import { AuthScreen, type QuickMember } from "@/components/auth/auth-screen";

// 진입점 — 로그인 화면(SCREENS §auth). 이미 로그인했으면 복귀(next) 또는 홈으로 보낸다.
// 데이터 읽기는 서버에서(ADR-015). 빠른 로그인 목록은 시드 멤버(데모/로컬용).

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ authError?: string; next?: string }>;
}) {
  const { authError, next: rawNext } = await searchParams;
  // 복귀 목적지(초대 링크 등) — 정제(same-origin path만, 오픈 리다이렉트 차단).
  const next = sanitizeNext(rawNext);

  const session = await getSession();
  if (session) redirect(next ?? "/dashboard");

  // dev 이메일/빠른 로그인은 로컬 개발에서만 — 프로덕션은 Google OAuth만(ADR-017).
  const allowDevLogin = process.env.NODE_ENV !== "production";
  const members = allowDevLogin
    ? await prisma.member.findMany({ orderBy: { createdAt: "asc" } })
    : [];
  const quick: QuickMember[] = members.map((m) => ({
    id: m.id,
    name: m.name,
    initial: m.initial,
    color: m.color,
    email: m.email,
    role: m.role,
  }));

  return (
    <AuthScreen
      members={quick}
      allowDevLogin={allowDevLogin}
      authError={authError ?? null}
      next={next}
    />
  );
}
