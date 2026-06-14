import { Topbar } from "@/components/shell";
import { Card } from "@/components/ui";
import { FinesPanel, RotationPanel, ScheduleBoard } from "@/components/schedule";
import { getSession } from "@/lib/auth";
import { getFines, getMonth, getScheduleMembers } from "@/lib/schedule";
import { draftMonthAction, reorderRotation, saveMonth, updateFines } from "./actions";

// 스케줄 — RSC. 읽기는 서버에서 Prisma 직접(ADR-015/R32). 쓰기는 actions.ts(Server Action).
// CRITICAL: 빈 달은 자동 생성하지 않는다 — GET이 row를 만들지 않는다(R15/ADR-006).
// 월은 ?y=&m= 쿼리로 결정(기본은 현재월). 토큰만 사용(R20).

interface PageProps {
  searchParams: Promise<{ y?: string; m?: string }>;
}

function parseIntOr(value: string | undefined, fallback: number): number {
  const n = Number(value);
  return Number.isInteger(n) ? n : fallback;
}

export default async function SchedulePage({ searchParams }: PageProps) {
  const sp = await searchParams;
  const now = new Date();
  const year = parseIntOr(sp.y, now.getFullYear());
  const rawMonth = parseIntOr(sp.m, now.getMonth() + 1);
  const month = Math.min(12, Math.max(1, rawMonth));

  const session = await getSession();
  const isAdmin = session?.role === "관리자";

  let body: React.ReactNode;
  try {
    const [monthData, fines, members] = await Promise.all([
      getMonth(year, month),
      getFines(year),
      getScheduleMembers(),
    ]);

    body = (
      <div className="mx-auto flex max-w-3xl flex-col gap-6 p-6">
        <div className="flex flex-col gap-1">
          <h1 className="text-[28px] leading-tight font-bold tracking-[-0.025em] text-fg">
            세미나 스케줄
          </h1>
          <p className="text-[13px] text-fg-muted">
            매주 토요일 · 멤버 로테이션 · 매달 직접 편성
          </p>
        </div>

        <ScheduleBoard
          // 월이 바뀌면 편집 로컬 상태를 깨끗이 리셋(편집 중 이동은 보드가 잠근다).
          key={`${year}-${month}`}
          year={year}
          month={month}
          monthData={monthData}
          members={members}
          onDraft={draftMonthAction}
          onSave={saveMonth}
        />

        <RotationPanel
          members={members}
          isAdmin={isAdmin}
          onReorder={reorderRotation}
        />

        <FinesPanel
          fines={fines}
          isAdmin={isAdmin}
          onUpdate={updateFines}
        />
      </div>
    );
  } catch {
    // 조회 실패: 화면을 통째로 날리지 않고 인라인 에러 카드 + 다시 시도(R26/R30).
    body = (
      <div className="p-6">
        <Card className="flex flex-col items-center gap-3 px-6 py-12 text-center">
          <p className="text-[15px] font-semibold text-fg">
            스케줄을 불러오지 못했어요.
          </p>
          <p className="max-w-sm text-[13px] text-fg-muted">
            잠깐 후 다시 시도해주세요.
          </p>
          <a
            href="/schedule"
            className="rounded-sm border border-border-strong px-3.5 py-1.5 text-[13px] font-medium text-fg hover:bg-bg-hover"
          >
            다시 시도
          </a>
        </Card>
      </div>
    );
  }

  return (
    <>
      <Topbar crumbs={[{ label: "스케쥴" }]} />
      <div className="flex-1 overflow-y-auto">{body}</div>
    </>
  );
}
