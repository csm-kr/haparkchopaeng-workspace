import { FileText, History } from "lucide-react";
import { Avatar, Badge, Card } from "@/components/ui";
import { SlideDeck } from "./slide-deck";
import type {
  AssetView,
  PresentationMeta,
  VersionView,
} from "./types";

// 자료 뷰어 — 요약·핵심 포인트·슬라이드 + 에셋 목록 + 버전 이력(있으면).
// 순수 렌더러(RSC). 토큰만 사용(R20). 댓글은 별도 클라이언트 섬(CommentThread).

export interface PresentationViewerProps {
  presentation: PresentationMeta;
  assets: AssetView[];
  versions: VersionView[];
}

const ASSET_LABEL: Record<AssetView["type"], string> = {
  pdf: "PDF",
  ppt: "PPT",
  note: "NOTE",
};

export function PresentationViewer({
  presentation,
  assets,
  versions,
}: PresentationViewerProps) {
  const { summary, keypoints, slides } = presentation;

  return (
    <div className="flex flex-col gap-5">
      {summary && (
        <Card className="p-4">
          <h2 className="text-[16px] font-semibold text-fg">요약</h2>
          <p className="mt-2 text-[13px] text-fg-muted">{summary}</p>
        </Card>
      )}

      {keypoints.length > 0 && (
        <Card className="p-4">
          <h2 className="text-[16px] font-semibold text-fg">핵심 포인트</h2>
          <ul className="mt-2 flex flex-col gap-1.5">
            {keypoints.map((k, i) => (
              <li key={i} className="flex gap-2 text-[13px] text-fg-muted">
                <span aria-hidden="true" className="text-accent">
                  •
                </span>
                <span>{k}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {slides.length > 0 && <SlideDeck slides={slides} />}

      {assets.length > 0 && (
        <Card className="p-4">
          <h2 className="text-[16px] font-semibold text-fg">첨부 자료</h2>
          <ul className="mt-2 flex flex-col gap-2">
            {assets.map((a) => (
              <li key={a.id}>
                <a
                  href={`/api/presentations/${presentation.id}/assets/${a.id}`}
                  download
                  className="flex items-center gap-2.5 rounded-md px-2 py-1.5 hover:bg-bg-hover"
                >
                  <FileText
                    size={15}
                    aria-hidden="true"
                    className="shrink-0 text-fg-subtle"
                  />
                  <span className="min-w-0 flex-1 truncate text-[13px] text-fg">
                    {a.name}
                  </span>
                  <Badge className="shrink-0 bg-bg-subtle text-fg-subtle">
                    {ASSET_LABEL[a.type]}
                  </Badge>
                  <span className="shrink-0 font-mono text-[11px] text-fg-faint">
                    {a.size}
                  </span>
                </a>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {versions.length > 0 && (
        <Card className="p-4">
          <h2 className="flex items-center gap-1.5 text-[16px] font-semibold text-fg">
            <History size={15} aria-hidden="true" /> 버전 이력
          </h2>
          <ul className="mt-2 flex flex-col gap-2">
            {versions.map((v) => (
              <li key={v.id} className="flex items-start gap-2.5">
                <Badge className="mt-0.5 shrink-0 bg-bg-subtle text-fg-muted">
                  {v.ver}
                </Badge>
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="text-[13px] text-fg-muted">{v.note}</span>
                  <span className="flex items-center gap-1.5 text-[11px] text-fg-subtle">
                    {v.by && <Avatar user={v.by} size="sm" />}
                    {v.by && <span>{v.by.name}</span>}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
