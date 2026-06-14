import { ExternalLink } from "lucide-react";
import { Card } from "@/components/ui";

// PDF 슬라이드 뷰어 — 첨부 PDF를 자산 라우트로 인라인 임베드한다(순수 표현, RSC/R20).
// 자산 라우트(/api/presentations/:id/assets/:assetId)는 단기 서명 URL로 302 리디렉트하고,
// 서명 URL은 inline 렌더된다(R36). iframe 렌더가 막히는 환경(일부 모바일)은 새 탭 링크로 받는다.

export interface PdfSlideViewerProps {
  presentationId: string;
  assetId: string;
  /** iframe 접근성 제목에 쓸 발표 제목 */
  name: string;
}

export function PdfSlideViewer({
  presentationId,
  assetId,
  name,
}: PdfSlideViewerProps) {
  const src = `/api/presentations/${presentationId}/assets/${assetId}`;

  return (
    <section className="flex flex-col gap-3" aria-label="슬라이드">
      <div className="flex items-center justify-between">
        <h2 className="text-[16px] font-semibold text-fg">슬라이드</h2>
        <a
          href={src}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 text-[13px] font-medium text-fg-muted hover:text-fg"
        >
          <ExternalLink size={14} aria-hidden="true" />
          새 탭에서 열기
        </a>
      </div>
      <Card>
        <iframe
          src={src}
          title={`${name} 슬라이드`}
          className="block h-[78vh] min-h-[420px] w-full"
        />
      </Card>
    </section>
  );
}
