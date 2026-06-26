import { describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ScheduleBoard } from "../schedule-board";
import { FinesPanel } from "../fines-panel";
import { RotationPanel } from "../rotation-panel";
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
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 5, 10)); // 6/10 → 6/14(2주차)가 이번 주(날짜 기준)
    try {
      makeBoard(savedMonth);
      expect(screen.getByText("완료")).toBeInTheDocument(); // 1주차 done
      expect(screen.getByText("이번 주")).toBeInTheDocument(); // 날짜 기준 이번 주
      expect(screen.getByRole("button", { name: /수정/ })).toBeInTheDocument();
      // 읽기전용 — 발표자 select가 없다
      expect(screen.queryByLabelText("1주차 발표자")).not.toBeInTheDocument();
      // 입장(/meeting) 링크는 제거됐다
      expect(
        screen.queryByRole("link", { name: /입장/ }),
      ).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it("모든 주차가 지난 달에는 '이번 주'를 붙이지 않는다(날짜 기준)", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 6, 1)); // 7/1 — 6월 주차는 모두 과거
    try {
      const pastMonth: ScheduleMonthView = {
        year: 2026,
        month: 6,
        day: "토요일",
        rotationPointerAfter: 0,
        version: 0,
        weeks: [
          { week: 1, date: "6월 6일", time: "10:00", presenterId: "ha", topic: "A", confirmed: true, status: "upcoming", presentationId: null },
          { week: 2, date: "6월 13일", time: "10:00", presenterId: "bak", topic: "B", confirmed: true, status: "upcoming", presentationId: null },
        ],
      };
      makeBoard(pastMonth);
      expect(screen.queryByText("이번 주")).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
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

// 설정이 없을 때 onCreate가 돌려줄 빈 장부(멤버 0행). SCREENS: 생성 직후 멤버 현황 표가 즉시 나타난다.
const emptyFines: FinesView = {
  year: 2026,
  finePresenter: 30000,
  fineAbsent: 10000,
  members: [],
};

// FinesPanel은 이제 year·onCreate·onUpdateLedger를 추가로 받는다 — 헬퍼로 기본값을 채워 렌더한다.
function renderFines(
  overrides: {
    fines?: FinesView | null;
    isAdmin?: boolean;
    year?: number;
    onUpdate?: (i: {
      year: number;
      finePresenter: number;
      fineAbsent: number;
    }) => Promise<FinesView>;
    onCreate?: (year: number) => Promise<FinesView>;
    onUpdateLedger?: (i: {
      year: number;
      rows: Array<{
        memberId: string;
        count: number;
        missedPresenter: number;
        missedAbsent: number;
        paid: number;
      }>;
    }) => Promise<FinesView>;
  } = {},
) {
  const onUpdate = overrides.onUpdate ?? vi.fn(async () => fines);
  const onCreate = overrides.onCreate ?? vi.fn(async () => emptyFines);
  const onUpdateLedger = overrides.onUpdateLedger ?? vi.fn(async () => fines);
  render(
    <FinesPanel
      fines={overrides.fines === undefined ? fines : overrides.fines}
      isAdmin={overrides.isAdmin ?? false}
      year={overrides.year ?? 2026}
      onUpdate={onUpdate}
      onCreate={onCreate}
      onUpdateLedger={onUpdateLedger}
    />,
  );
  return { onUpdate, onCreate, onUpdateLedger };
}

describe("FinesPanel — 파생 벌금 + 관리자 전용 수정", () => {
  it("누적 벌금·미납을 파생 계산해 표시한다(완납/미납 구분)", () => {
    renderFines({ isAdmin: false });
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
    renderFines({ isAdmin: false });
    expect(screen.queryByRole("button", { name: /수정/ })).not.toBeInTheDocument();
  });

  it("관리자는 벌금을 수정하면 표가 즉시 재계산된다", async () => {
    const onUpdate = vi.fn(
      async (): Promise<FinesView> => ({
        ...fines,
        finePresenter: 50000,
      }),
    );
    renderFines({ isAdmin: true, onUpdate });
    // 금액 설정 카드 토글(정확히 "수정") — 멤버 현황 토글("멤버 현황 수정")과 구분된다.
    fireEvent.click(screen.getByRole("button", { name: "수정" }));
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

describe("FinesPanel — 설정 생성 + 장부 편집(관리자 전용)", () => {
  it("비관리자 + 설정 없음: '벌금 설정 시작' 버튼이 없고 안내문만 보인다", () => {
    renderFines({ fines: null, isAdmin: false });
    expect(
      screen.getByText("이 해의 벌금 설정이 아직 없어요."),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "벌금 설정 시작" }),
    ).not.toBeInTheDocument();
  });

  it("관리자 + 설정 없음: '벌금 설정 시작'을 누르면 onCreate(year)가 호출된다", async () => {
    const onCreate = vi.fn(async () => emptyFines);
    renderFines({ fines: null, isAdmin: true, year: 2026, onCreate });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "벌금 설정 시작" }));
    });
    expect(onCreate).toHaveBeenCalledWith(2026);
  });

  it("비관리자 + 설정 있음: 멤버 현황 표에 수정 토글이 없다(읽기 전용)", () => {
    renderFines({ fines, isAdmin: false });
    expect(
      screen.queryByRole("button", { name: "멤버 현황 수정" }),
    ).not.toBeInTheDocument();
  });

  it("관리자 + 설정 있음: 표를 편집해 저장하면 onUpdateLedger가 {year, rows}로 호출된다", async () => {
    const onUpdateLedger = vi.fn(async () => fines);
    renderFines({ fines, isAdmin: true, year: 2026, onUpdateLedger });
    // 표 전체 편집 모드 진입(금액 토글과 구분되는 "멤버 현황 수정").
    fireEvent.click(screen.getByRole("button", { name: "멤버 현황 수정" }));
    // 참여·발표자 불참·일반 불참·납부가 숫자 입력으로 — 한 멤버의 '참여'를 바꾼다.
    fireEvent.change(screen.getByLabelText("하수현 참여"), {
      target: { value: "9" },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "멤버 현황 저장" }));
    });
    expect(onUpdateLedger).toHaveBeenCalledTimes(1);
    const arg = onUpdateLedger.mock.calls[0][0];
    expect(arg.year).toBe(2026);
    const haRow = arg.rows.find((r) => r.memberId === "ha");
    // 바꾼 값(참여 9)이 담기고, 나머지 원자료는 그대로. 누적/미납은 보내지 않는다(파생).
    expect(haRow).toMatchObject({
      memberId: "ha",
      count: 9,
      missedPresenter: 0,
      missedAbsent: 1,
      paid: 10000,
    });
    expect(haRow).not.toHaveProperty("accruedFine");
    expect(haRow).not.toHaveProperty("outstanding");
  });
});

describe("RotationPanel — 로테이션 편성(관리자)", () => {
  it("관리자가 아니면 편성 버튼을 노출하지 않는다(👑)", () => {
    render(
      <RotationPanel members={members} isAdmin={false} onReorder={vi.fn()} />,
    );
    expect(
      screen.queryByRole("button", { name: "편성" }),
    ).not.toBeInTheDocument();
  });

  it("관리자가 순서를 바꿔 저장하면 onReorder가 새 순서로 호출된다", async () => {
    const onReorder = vi.fn(async () => members);
    render(<RotationPanel members={members} isAdmin onReorder={onReorder} />);
    fireEvent.click(screen.getByRole("button", { name: "편성" }));
    // 1번 하수현(ha)을 아래로 → [bak, ha, jo, paeng]
    fireEvent.click(screen.getByRole("button", { name: "하수현 아래로" }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "저장" }));
    });
    expect(onReorder).toHaveBeenCalledWith(["bak", "ha", "jo", "paeng"]);
  });
});
