import { prisma } from "@/lib/prisma";
import type { PaperListItem, PaperUploader } from "@/components/library";
import type { AnalysisStatus } from "@/types";

// 논문 목록 서버 조회 — 읽기는 RSC에서 Prisma 직접(ADR-015/R32).
// 클라이언트는 이 데이터를 fetch하지 않는다.

/** Paper.tags(Json)를 string[]로 안전하게 좁힌다. 첫 항목을 종류 태그로 쓴다. */
function firstTag(tags: unknown): string | null {
  if (Array.isArray(tags)) {
    const first = tags[0];
    if (typeof first === "string" && first.length > 0) return first;
  }
  return null;
}

/** DB의 analysisStatus(String)를 유니온으로 좁힌다. 미지정 값은 pending으로 본다. */
function toAnalysisStatus(value: string): AnalysisStatus {
  return value === "ready" || value === "failed" ? value : "pending";
}

export async function getPapers(): Promise<PaperListItem[]> {
  // 논문 + 업로더(Member)를 함께 읽는다. Paper.uploadedBy는 Member.id이지만
  // 스키마에 관계가 없어 멤버를 한 번에 조회해 맵으로 합친다.
  const [papers, members] = await Promise.all([
    prisma.paper.findMany({
      orderBy: { uploadedAt: "desc" },
      select: {
        id: true,
        title: true,
        authors: true,
        tags: true,
        analysisStatus: true,
        uploadedBy: true,
        uploadedAt: true,
      },
    }),
    prisma.member.findMany({
      select: { id: true, name: true, initial: true, color: true },
    }),
  ]);

  const byId = new Map<string, PaperUploader>(
    members.map((m) => [
      m.id,
      { name: m.name, initial: m.initial, color: m.color },
    ]),
  );

  return papers.map((p) => ({
    id: p.id,
    title: p.title,
    authors: p.authors,
    tag: firstTag(p.tags),
    analysisStatus: toAnalysisStatus(p.analysisStatus),
    uploadedAt: p.uploadedAt.toISOString(),
    uploader: byId.get(p.uploadedBy) ?? null,
  }));
}
