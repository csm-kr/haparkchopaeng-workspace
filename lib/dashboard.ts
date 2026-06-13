import { prisma } from "@/lib/prisma";
import type { RecentPaper, RecentPresentation } from "@/components/dashboard";

// 홈(대시보드) 서버 조회 — 읽기는 RSC에서 Prisma 직접(ADR-015/R32).
// 클라이언트는 이 데이터를 fetch하지 않는다.

const RECENT_LIMIT = 5;

export interface DashboardData {
  paperCount: number;
  presentationCount: number;
  recentPapers: RecentPaper[];
  recentPresentations: RecentPresentation[];
}

export async function getDashboardData(): Promise<DashboardData> {
  const [paperCount, presentationCount, papers, presentations] =
    await Promise.all([
      prisma.paper.count(),
      prisma.presentation.count(),
      prisma.paper.findMany({
        orderBy: { uploadedAt: "desc" },
        take: RECENT_LIMIT,
        select: { id: true, title: true, authors: true, uploadedAt: true },
      }),
      prisma.presentation.findMany({
        orderBy: { date: "desc" },
        take: RECENT_LIMIT,
        select: { id: true, title: true, date: true },
      }),
    ]);

  return {
    paperCount,
    presentationCount,
    recentPapers: papers.map((p) => ({
      id: p.id,
      title: p.title,
      authors: p.authors,
      uploadedAt: p.uploadedAt.toISOString(),
    })),
    recentPresentations: presentations.map((pr) => ({
      id: pr.id,
      title: pr.title,
      date: pr.date.toISOString(),
    })),
  };
}
