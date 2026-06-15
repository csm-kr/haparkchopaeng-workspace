import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

// MeetHeader 단위 테스트 — 송출 타이머(startedAt 기준 경과)·LIVE 표시(색+텍스트, R29).
// 시계는 주입(now)해 mm:ss를 결정적으로 검증한다. LiveKit 컨텍스트 불필요(타이머는 startedAt만).

const { fmtElapsed, MeetHeader } = await import("@/components/live/meet-header");

afterEach(() => cleanup());

describe("fmtElapsed", () => {
  it("1시간 미만은 mm:ss", () => {
    expect(fmtElapsed(0)).toBe("00:00");
    expect(fmtElapsed(5)).toBe("00:05");
    expect(fmtElapsed(65)).toBe("01:05");
    expect(fmtElapsed(125)).toBe("02:05");
  });

  it("1시간 이상은 h:mm:ss", () => {
    expect(fmtElapsed(3600)).toBe("1:00:00");
    expect(fmtElapsed(3725)).toBe("1:02:05");
  });

  it("음수는 00:00으로 클램프", () => {
    expect(fmtElapsed(-10)).toBe("00:00");
  });
});

describe("MeetHeader", () => {
  it("startedAt에서 경과한 시간을 mm:ss로 렌더(고정 시계 주입)", () => {
    render(
      <MeetHeader
        startedAt="2026-06-15T01:00:00Z"
        presenterName="조성민"
        now={() => Date.parse("2026-06-15T01:02:05Z")}
      />,
    );
    expect(screen.getByText("02:05")).toBeInTheDocument();
    // LIVE는 색만이 아니라 텍스트로도 알린다(R29).
    expect(screen.getByText("LIVE")).toBeInTheDocument();
    expect(screen.getByText(/조성민님이 발표 중/)).toBeInTheDocument();
  });

  it("1시간 넘으면 h:mm:ss", () => {
    render(
      <MeetHeader
        startedAt="2026-06-15T01:00:00Z"
        now={() => Date.parse("2026-06-15T02:02:05Z")}
      />,
    );
    expect(screen.getByText("1:02:05")).toBeInTheDocument();
  });

  it("startedAt이 없으면 00:00", () => {
    render(<MeetHeader startedAt={null} now={() => 1_000_000} />);
    expect(screen.getByText("00:00")).toBeInTheDocument();
  });

  it("action을 그대로 렌더한다", () => {
    render(
      <MeetHeader
        startedAt={null}
        action={<button type="button">라이브 종료</button>}
      />,
    );
    expect(
      screen.getByRole("button", { name: "라이브 종료" }),
    ).toBeInTheDocument();
  });
});
