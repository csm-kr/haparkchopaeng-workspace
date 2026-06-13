import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { AuthScreen, type QuickMember } from "@/components/auth/auth-screen";

// 진입점 — 로그인 화면(SCREENS §auth). 이미 로그인했으면 홈으로 보낸다.
// 데이터 읽기는 서버에서(ADR-015). 빠른 로그인 목록은 시드 멤버(데모/로컬용).

export default async function Home() {
  const session = await getSession();
  if (session) redirect("/dashboard");

  const members = await prisma.member.findMany({ orderBy: { createdAt: "asc" } });
  const quick: QuickMember[] = members.map((m) => ({
    id: m.id,
    name: m.name,
    initial: m.initial,
    color: m.color,
    email: m.email,
    role: m.role,
  }));

  return <AuthScreen members={quick} />;
}
