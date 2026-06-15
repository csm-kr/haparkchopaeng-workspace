import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

// RoomStage — 화면공유 시 얼굴을 오른쪽 세로 스트립으로 + 표시 개수 조절(−/+).
// 보이는 얼굴 우선순위: 말하는 사람 → 발표자 → 나머지. 공유 화면엔 '발표 중' 라벨.
// 개수(visibleCount)는 컴포넌트 state라 공유 소스가 바뀌어도 유지된다.

const lk = vi.hoisted(() => ({
  participants: [] as Array<{ identity: string; name?: string; isSpeaking?: boolean }>,
  tracks: [] as unknown[],
}));

vi.mock("livekit-client", () => ({
  Track: { Source: { Camera: "camera", ScreenShare: "screen_share" } },
}));

vi.mock("@livekit/components-react", () => ({
  RoomAudioRenderer: () => null,
  VideoTrack: () => null,
  useParticipants: () => lk.participants,
  useTracks: () => lk.tracks,
}));

const { RoomStage, orderParticipantsForStrip } = await import(
  "@/components/live/room-stage"
);

const members = [
  { id: "jo", name: "조성민", initial: "조", color: "var(--m-jo)" },
  { id: "ha", name: "하수현", initial: "하", color: "var(--m-ha)" },
  { id: "bak", name: "박진희", initial: "박", color: "var(--m-bak)" },
  { id: "paeng", name: "팽수", initial: "팽", color: "var(--m-paeng)" },
];

function renderStage() {
  return render(
    <RoomStage
      members={members}
      presenterId="jo"
      currentMemberId="ha"
      hands={new Set()}
    />,
  );
}

function share() {
  return { source: "screen_share", publication: {}, participant: { identity: "jo" } };
}

beforeEach(() => {
  lk.participants = [];
  lk.tracks = [];
});
afterEach(() => cleanup());

describe("orderParticipantsForStrip", () => {
  it("말하는 사람 → 발표자 → 나머지(원래 순서)로 정렬한다", () => {
    const ps = [
      { identity: "jo" }, // 발표자
      { identity: "ha" }, // 나머지
      { identity: "bak", isSpeaking: true }, // 말하는 중
      { identity: "paeng" }, // 나머지
    ];
    expect(orderParticipantsForStrip(ps, "jo").map((p) => p.identity)).toEqual([
      "bak",
      "jo",
      "ha",
      "paeng",
    ]);
  });
});

describe("RoomStage 화면공유", () => {
  it("공유 화면에 '○○님이 발표 중' 라벨을 보인다", () => {
    lk.participants = [{ identity: "jo" }, { identity: "ha" }];
    lk.tracks = [share()];
    renderStage();
    expect(screen.getByText(/조성민님이 발표 중/)).toBeInTheDocument();
  });

  it("기본 2명 표시 + '+'로 늘리고 '−'로 줄인다", () => {
    lk.participants = [
      { identity: "jo" },
      { identity: "ha" },
      { identity: "bak" },
      { identity: "paeng" },
    ];
    lk.tracks = [share()];
    const { container } = renderStage();
    expect(container.querySelectorAll("[data-identity]")).toHaveLength(2);

    fireEvent.click(screen.getByRole("button", { name: "얼굴 수 늘리기" }));
    expect(container.querySelectorAll("[data-identity]")).toHaveLength(3);

    fireEvent.click(screen.getByRole("button", { name: "얼굴 수 줄이기" }));
    fireEvent.click(screen.getByRole("button", { name: "얼굴 수 줄이기" }));
    expect(container.querySelectorAll("[data-identity]")).toHaveLength(1);
  });

  it("공유 소스가 바뀌어도 선택한 얼굴 수가 유지된다(따라다님)", () => {
    lk.participants = [
      { identity: "jo" },
      { identity: "ha" },
      { identity: "bak" },
      { identity: "paeng" },
    ];
    lk.tracks = [share()];
    const { container, rerender } = renderStage();
    fireEvent.click(screen.getByRole("button", { name: "얼굴 수 늘리기" })); // 2→3
    expect(container.querySelectorAll("[data-identity]")).toHaveLength(3);

    // 공유 소스 변경(새 트랙 객체) — 같은 컴포넌트, state 유지
    lk.tracks = [share()];
    rerender(
      <RoomStage
        members={members}
        presenterId="jo"
        currentMemberId="ha"
        hands={new Set()}
      />,
    );
    expect(container.querySelectorAll("[data-identity]")).toHaveLength(3);
  });

  it("공유가 없으면 전원 그리드 + 개수 조절 없음", () => {
    lk.participants = [{ identity: "jo" }, { identity: "ha" }];
    lk.tracks = [];
    const { container } = renderStage();
    expect(container.querySelectorAll("[data-identity]")).toHaveLength(2);
    expect(
      screen.queryByRole("button", { name: "얼굴 수 늘리기" }),
    ).toBeNull();
  });
});
