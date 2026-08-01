import { expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";

// 사용량 패널: 추정치 표기(필수) · 한도 대비 표시 · 팀별 분해 · 빈 상태.

const { UsagePanel } = await import("../usage-panel");

const USAGE = {
  usedMinutes: 240,
  limitMinutes: 1000,
  remainingMinutes: 760,
  byTeam: [{ teamId: "t1", teamName: "하박조팽", minutes: 240 }],
};
const TREND = [
  { month: "2026-07", minutes: 100 },
  { month: "2026-08", minutes: 240 },
];

it("사용량과 한도를 보여준다", () => {
  render(<UsagePanel usage={USAGE} trend={TREND} />);
  // "240분"은 큰 숫자·월별 추이·팀별에 모두 나온다 — status 영역으로 좁혀서 단언한다.
  const status = within(screen.getByRole("status"));
  expect(status.getByText(/240분/)).toBeInTheDocument();
  expect(status.getByText(/1,000분/)).toBeInTheDocument();
  expect(status.getByText(/760분/)).toBeInTheDocument();
});

it("추정치임을 반드시 표기한다", () => {
  render(<UsagePanel usage={USAGE} trend={TREND} />);
  expect(screen.getByText(/추정치/)).toBeInTheDocument();
});

it("팀별 분해를 보여준다", () => {
  render(<UsagePanel usage={USAGE} trend={TREND} />);
  expect(screen.getByText("하박조팽")).toBeInTheDocument();
});

it("사용량이 없으면 빈 상태 문구를 보여준다", () => {
  render(
    <UsagePanel
      usage={{ usedMinutes: 0, limitMinutes: 1000, remainingMinutes: 1000, byTeam: [] }}
      trend={TREND}
    />,
  );
  expect(screen.getByText(/이번 달 라이브 사용 기록이 없어요/)).toBeInTheDocument();
});

it("한도의 80%를 넘으면 경고 표시를 붙인다", () => {
  render(
    <UsagePanel
      usage={{ usedMinutes: 900, limitMinutes: 1000, remainingMinutes: 100, byTeam: [] }}
      trend={TREND}
    />,
  );
  expect(screen.getByRole("status")).toHaveAttribute("data-level", "warn");
});

it("한도를 다 쓰면 위험 표시를 붙인다", () => {
  render(
    <UsagePanel
      usage={{ usedMinutes: 1000, limitMinutes: 1000, remainingMinutes: 0, byTeam: [] }}
      trend={TREND}
    />,
  );
  expect(screen.getByRole("status")).toHaveAttribute("data-level", "danger");
});
