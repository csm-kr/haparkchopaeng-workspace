import { describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ScheduleBoard } from "../schedule-board";
import { FinesPanel } from "../fines-panel";
import type {
  FinesView,
  MemberOption,
  SaveMonthResult,
  ScheduleMonthView,
  ScheduleWeekView,
} from "../types";

// next/navigation을 고정 — 라우터 없이 렌더(월 이동은 push 호출만 확인하지 않음).
const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
}));

const members: MemberOption[] = [
  { id: "ha", name: "하수현", initial: "하", color: "var(--m-ha)", availability: "active" },
  { id: "bak", name: "박진희", initial: "박", color: "var(--m-bak)", availability: "active" },
  { id: "jo", name: "조성민", initial: "조", color: "var(--m-jo)", availability: "active" },
  { id: "paeng", name: "팽진욱", initial: "팽", color: "var(--m-paeng)", availability: "active" },
];

const draftWeeks: ScheduleWeekView[] = [
  { week: 1, date: "7월 4일", time: "10:00", presenterId: "bak", topic: "", confirmed: false, status: "upcoming", presentationId: null },
  { week: 2, date: "7월 11일", time: "10:00", presenterId: "jo", topic: "", confirmed: false, status: "upcoming", presentationId: null },
  { week: 3, date: "7월 18일", time: "10:00", presenterId: "paeng", topic: "", confirmed: false, status: "upcoming", presentationId: null },
  { week: 4, date: "7월 25일", time: "10:00", presenterId: "ha", topic: "", confirmed: false, status: "upcoming", presentationId: null },
];

const savedMonth: ScheduleMonthView = {
  year: 2026,
  month: 6,
  day: "토요일",
  rotationPointerAfter: 1,
  version: 0,
  weeks: [
    { week: 1, date: "6월 7일", time: "10:00", presenterId: "jo", topic: "MoD 리뷰", confirmed: true, status: "done", presentationId: "pres1" },
    { week: 2, date: "6월 14일", time: "10:00", presenterId: "bak", topic: "Diffusion Forcing", confirmed: true, status: "upcoming", presentationId: "pres2" },
  ],
};

function makeBoard(monthData: ScheduleMonthView | null, onDraft = vi.fn(async () => draftWeeks)) {
  const onSave = vi.fn(
    async (): Promise<SaveMonthResult> => ({ ok: true, month: savedMonth }),
  );
  render(
    <ScheduleBoard
      year={2026}
      month={7}
      monthData={monthData}
      members={members}
      onDraft={onDraft}
      onSave={onSave}
    />,
  );
  return { onDraft, onSave };
}

describe("ScheduleBoard — 빈/편집/확정 상태", () => {
  it("빈 달은 비어 있는 그대로 + [일정 짜기] 하나만 보인다(R15/R21)", () => {
    makeBoard(null);
    expect(screen.getByText("이 달은 아직 일정이 없어요")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "일정 짜기" }),
    ).toBeInTheDocument();
  });

  it("[일정 짜기]를 누르면 초안을 받아 편집 모드(행 + 저장 바)로 들어간다", async () => {
    const { onDraft } = makeBoard(null);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "일정 짜기" }));
    });
    expect(onDraft).toHaveBeenCalledWith(2026, 7);
    // 편집 모드: 발표자 select 4개 + 저장 바("확정 0/4")
    await waitFor(() =>
      expect(screen.getByText(/확정 0\/4/)).toBeInTheDocument(),
    );
    expect(screen.getByRole("button", { name: "저장" })).toBeInTheDocument();
    expect(screen.getByLabelText("1주차 발표자")).toBeInTheDocument();
  });

  it("확정(저장된) 달은 읽기전용 행 + 상태 알약 + [수정]을 보인다", () => {
    makeBoard(savedMonth);
    expect(screen.getByText("완료")).toBeInTheDocument(); // 1주차 done
    expect(screen.getByText("이번 주")).toBeInTheDocument(); // 첫 비-done = current(파생)
    expect(screen.getByRole("button", { name: /수정/ })).toBeInTheDocument();
    // 읽기전용 — 발표자 select가 없다
    expect(screen.queryByLabelText("1주차 발표자")).not.toBeInTheDocument();
  });

  it("편집 중에는 월 이동이 잠긴다(라우터 push 호출 안 함 + 안내)", async () => {
    push.mockClear();
    makeBoard(null);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "일정 짜기" }));
    });
    await screen.findByRole("button", { name: "저장" });
    fireEvent.click(screen.getByRole("button", { name: "다음 달" }));
    expect(push).not.toHaveBeenCalled();
    expect(
      screen.getByText(/편집 중에는 달을 옮길 수 없어요/),
    ).toBeInTheDocument();
  });
});

const fines: FinesView = {
  year: 2026,
  finePresenter: 30000,
  fineAbsent: 10000,
  members: [
    { memberId: "ha", name: "하수현", initial: "하", color: "var(--m-ha)", count: 6, missedPresenter: 0, missedAbsent: 1, paid: 10000 },
    { memberId: "jo", name: "조성민", initial: "조", color: "var(--m-jo)", count: 7, missedPresenter: 1, missedAbsent: 1, paid: 30000 },
  ],
};

describe("FinesPanel — 파생 벌금 + 관리자 전용 수정", () => {
  it("누적 벌금·미납을 파생 계산해 표시한다(완납/미납 구분)", () => {
    render(
      <FinesPanel
        fines={fines}
        members={members}
        isAdmin={false}
        onUpdate={vi.fn()}
      />,
    );
    // jo: 누적 40,000(발표자불참1*30000 + 일반불참1*10000) — 표에서 유일
    expect(screen.getByText("40,000원")).toBeInTheDocument();
    // jo: 미납 10,000은 미납 색(text-busy) 셀로만 — 그 셀이 존재한다
    const unpaid = screen
      .getAllByText("10,000원")
      .filter((el) => el.className.includes("text-busy"));
    expect(unpaid).toHaveLength(1);
    // ha: 누적 10,000 / 납부 10,000 → 완납
    expect(screen.getByText("완납")).toBeInTheDocument();
  });

  it("비관리자에게는 벌금 수정 버튼을 노출하지 않는다(👑)", () => {
    render(
      <FinesPanel
        fines={fines}
        members={members}
        isAdmin={false}
        onUpdate={vi.fn()}
      />,
    );
    expect(screen.queryByRole("button", { name: /수정/ })).not.toBeInTheDocument();
  });

  it("관리자는 벌금을 수정하면 표가 즉시 재계산된다", async () => {
    const onUpdate = vi.fn(
      async (): Promise<FinesView> => ({
        ...fines,
        finePresenter: 50000,
      }),
    );
    render(
      <FinesPanel
        fines={fines}
        members={members}
        isAdmin
        onUpdate={onUpdate}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /수정/ }));
    fireEvent.change(screen.getByLabelText("발표자 불참 벌금"), {
      target: { value: "50000" },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "저장" }));
    });
    expect(onUpdate).toHaveBeenCalledWith({
      year: 2026,
      finePresenter: 50000,
      fineAbsent: 10000,
    });
    // jo: 발표자불참1*50000 + 일반불참1*10000 = 60,000 누적으로 재계산
    await waitFor(() =>
      expect(screen.getByText("60,000원")).toBeInTheDocument(),
    );
  });
});
