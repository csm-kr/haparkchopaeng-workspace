import { Topbar } from "@/components/shell";
import { Card } from "@/components/ui";
import { PaperList } from "@/components/library";
import { UploadButton } from "@/components/upload";
import { getPapers } from "@/lib/papers";
import { getSession } from "@/lib/auth";
import { quotaStatus } from "@/lib/rate-limit";

// 논문 목록 — RSC. 읽기는 서버에서 Prisma 직접 조회(ADR-015/R32).
// 로딩 상태는 같은 폴더의 loading.tsx(스켈레톤)가 담당한다(R26).
// 빈 상태는 PaperList가 내부에서 처리한다(R26).

export default async function LibraryPage() {
  const session = await getSession();
  const quota = session
    ? await quotaStatus(session.memberId).catch(() => undefined)
    : undefined;
  let content: React.ReactNode;
  try {
    const papers = await getPapers();
    content = <PaperList papers={papers} />;
  } catch {
    // 조회 실패: 화면을 통째로 날리지 않고 인라인 에러 카드 + 다시 시도(R26/R30).
    content = (
      <Card className="flex flex-col items-center gap-3 px-6 py-12 text-center">
        <p className="text-[15px] font-semibold text-fg">
          논문 목록을 불러오지 못했어요.
        </p>
        <p className="max-w-sm text-[13px] text-fg-muted">
          잠깐 후 다시 시도해주세요.
        </p>
        <a
          href="/library"
          className="rounded-sm border border-border-strong px-3.5 py-1.5 text-[13px] font-medium text-fg hover:bg-bg-hover"
        >
          다시 시도
        </a>
      </Card>
    );
  }

  return (
    <>
      <Topbar crumbs={[{ label: "논문" }]} actions={<UploadButton quota={quota} />} />
      <div className="flex-1 overflow-y-auto">
        <div className="p-6">{content}</div>
      </div>
    </>
  );
}
