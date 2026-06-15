import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

// PeoplePanel 단위 테스트 — LiveKit presence(useParticipants) 기준 로스터.
// 마이크 on/off·손들기는 색+아이콘/텍스트 병행(R29). 작성자/참가자는 identity로 매핑(R3).

const lk = vi.hoisted(() => ({
  participants: [] as Array<{
    identity: string;
    name?: string;
    isMicrophoneEnabled?: boolean;
    isLocal?: boolean;
  }>,
}));

vi.mock("@livekit/components-react", () => ({
  useParticipants: () => lk.participants,
}));

const { PeoplePanel } = await import("@/components/live/people-panel");

const members = [
  { id: "ha", name: "하수현", initial: "하", color: "var(--m-ha)" },
  { id: "jo", name: "조성민", initial: "조", color: "var(--m-jo)" },
];

beforeEach(() => {
  vi.clearAllMocks();
  lk.participants = [];
});
afterEach(() => cleanup());

describe("PeoplePanel", () => {
  it("참가자가 없으면 빈 상태(R26)", () => {
    render(
      <PeoplePanel
        members={members}
        presenterId="ha"
        currentMemberId="jo"
        hands={new Set()}
      />,
    );
    expect(screen.getByText(/아직 아무도 없어요/)).toBeInTheDocument();
  });

  it("presence 로스터: 이름·발표자·마이크 상태를 보여준다", () => {
    lk.participants = [
      { identity: "ha", name: "하수현", isMicrophoneEnabled: true },
      { identity: "jo", name: "조성민", isMicrophoneEnabled: false, isLocal: true },
    ];
    render(
      <PeoplePanel
        members={members}
        presenterId="ha"
        currentMemberId="jo"
        hands={new Set()}
      />,
    );
    expect(screen.getByText("하수현")).toBeInTheDocument();
    // 발표자 표기(색이 아니라 텍스트로도, R29)
    expect(screen.getByText(/발표자/)).toBeInTheDocument();
    // 본인 표기
    expect(screen.getByText(/조성민/)).toBeInTheDocument();
    // 마이크 상태: 켠/끈 라벨이 텍스트로 존재(색에만 의존 금지, R29)
    expect(screen.getByText("마이크 켬")).toBeInTheDocument();
    expect(screen.getByText("마이크 끔")).toBeInTheDocument();
  });

  it("손든 참가자는 손들기 표시(색+텍스트, R29)", () => {
    lk.participants = [{ identity: "jo", name: "조성민", isMicrophoneEnabled: true }];
    render(
      <PeoplePanel
        members={members}
        presenterId="ha"
        currentMemberId="ha"
        hands={new Set(["jo"])}
      />,
    );
    expect(screen.getByText("손 들었어요")).toBeInTheDocument();
  });
});
