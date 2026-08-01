import { notFound } from "next/navigation";
import { requireSuperAdmin } from "@/lib/auth";
import { currentMonthUsage, monthlyTrend } from "@/lib/live-usage";
import { prisma } from "@/lib/prisma";
import { maxTeams } from "@/lib/settings";
import { MaxTeamsForm } from "./max-teams-form";
import { UsagePanel } from "./usage-panel";

// 관리자 콘솔(ADR-023). (app) 셸 밖의 전역 화면 — 활성 팀 컨텍스트와 무관하다(/teams 로비와 같은 층위).
// CRITICAL: 게이트는 ADMIN_EMAIL 일치. 실패는 403이 아니라 404 — 존재 자체를 숨긴다(R19).
// 읽기는 서버에서(ADR-015). 쓰기는 actions.ts의 Server Action이 권한을 재강제한다.

export default async function AdminPage() {
  try {
    await requireSuperAdmin();
  } catch {
    notFound();
  }

  const [usage, trend, teamCount, limit] = await Promise.all([
    currentMonthUsage(),
    monthlyTrend(6),
    prisma.team.count(),
    maxTeams(),
  ]);

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-2xl flex-col gap-8 p-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-[22px] font-bold tracking-[-0.02em] text-fg">관리자</h1>
        <p className="text-[13px] text-fg-muted">서버 전체 설정과 사용량이에요.</p>
      </header>

      <div className="rounded-lg border border-border-token bg-bg-elevated p-6">
        <UsagePanel usage={usage} trend={trend} />
      </div>

      <div className="flex flex-col gap-4 rounded-lg border border-border-token bg-bg-elevated p-6">
        <h2 className="text-[15px] font-semibold text-fg">설정</h2>
        <MaxTeamsForm current={limit} teamCount={teamCount} />
      </div>
    </main>
  );
}
