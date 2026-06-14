import { prisma } from "@/lib/prisma";
import type { PaperListItem, PaperUploader } from "@/components/library";
import type { FigureView, NoteView } from "@/components/analyzer";
import type {
  AnalysisStatus,
  NoteLens,
  ReproPayload,
  ResearchPayload,
} from "@/types";

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

/** 논문 상세(헤더 메타 — 원문 PDF 다운로드 유일 액션, R13). */
export interface PaperDetailMeta {
  id: string;
  title: string;
  authors: string;
  venue: string | null;
  year: number | null;
  arxiv: string | null;
  pageCount: number | null;
  abstract: string | null;
  pdfUrl: string;
  uploadedBy: string;
  analysisStatus: AnalysisStatus;
}

export interface PaperDetailView {
  paper: PaperDetailMeta;
  /** 관점별 구조화 분석. 없으면 null(분석 대기/실패). */
  research: ResearchPayload | null;
  repro: ReproPayload | null;
  /** Figure는 두 관점 공통(ADR-004) */
  figures: FigureView[];
  /** 섹션별 작성자 표기 노트(ADR-005) */
  notes: NoteView[];
}

export async function getPaperDetail(
  id: string,
): Promise<PaperDetailView | null> {
  // 읽기는 RSC에서 Prisma 직접(ADR-015/R32). 분석·figure·노트를 함께 읽는다.
  const paper = await prisma.paper.findUnique({
    where: { id },
    include: {
      analyses: true,
      figures: { orderBy: { sourcePage: "asc" } },
      notes: { orderBy: { createdAt: "asc" } },
    },
  });
  if (!paper) return null;

  // 노트 작성자(Member)는 관계가 없어 맵으로 합친다(getPapers와 동일 패턴).
  const members = await prisma.member.findMany({
    select: { id: true, name: true, initial: true, color: true },
  });
  const byId = new Map(members.map((m) => [m.id, m]));

  // payload(Json)는 시드/추출 스키마와 1:1 — DTO로 좁힌다(any 미사용).
  const research = paper.analyses.find((a) => a.lens === "research")?.payload;
  const repro = paper.analyses.find((a) => a.lens === "repro")?.payload;

  return {
    paper: {
      id: paper.id,
      title: paper.title,
      authors: paper.authors,
      venue: paper.venue,
      year: paper.year,
      arxiv: paper.arxiv,
      pageCount: paper.pageCount,
      abstract: paper.abstract,
      pdfUrl: paper.pdfUrl,
      uploadedBy: paper.uploadedBy,
      analysisStatus: toAnalysisStatus(paper.analysisStatus),
    },
    research: research ? (research as unknown as ResearchPayload) : null,
    repro: repro ? (repro as unknown as ReproPayload) : null,
    figures: paper.figures.map((f) => ({
      id: f.id,
      title: f.title,
      caption: f.caption,
      interpretation: f.interpretation,
      sourcePage: f.sourcePage,
      // DB엔 스토리지 경로, 클라엔 서명 라우트 URL을 노출한다(R36). 없으면 null(아직 렌더 전).
      imageUrl: f.imageUrl ? `/api/figures/${f.id}/image` : null,
    })),
    notes: paper.notes.map((n) => ({
      id: n.id,
      sectionId: n.sectionId,
      lens: n.lens as NoteLens,
      title: n.title,
      body: n.body,
      createdAt: n.createdAt.toISOString(),
      author: byId.get(n.authorId) ?? null,
    })),
  };
}
