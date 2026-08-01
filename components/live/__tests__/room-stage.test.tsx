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

  it("'−'로 0명까지 접으면 얼굴이 사라지고 헤더만 남는다", () => {
    lk.participants = [{ identity: "jo" }, { identity: "ha" }, { identity: "bak" }];
    lk.tracks = [share()];
    const { container } = renderStage();

    const minus = screen.getByRole("button", { name: "얼굴 수 줄이기" });
    fireEvent.click(minus); // 2 → 1
    fireEvent.click(minus); // 1 → 0

    expect(container.querySelectorAll("[data-identity]")).toHaveLength(0);
    // 헤더는 남아 있어야 다시 늘릴 수 있다.
    expect(screen.getByText(/얼굴 0/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "얼굴 수 줄이기" })).toBeDisabled();
  });

  it("0명에서 '+'를 누르면 다시 1명이 보인다", () => {
    lk.participants = [{ identity: "jo" }, { identity: "ha" }, { identity: "bak" }];
    lk.tracks = [share()];
    const { container } = renderStage();

    const minus = screen.getByRole("button", { name: "얼굴 수 줄이기" });
    fireEvent.click(minus);
    fireEvent.click(minus);
    expect(container.querySelectorAll("[data-identity]")).toHaveLength(0);

    fireEvent.click(screen.getByRole("button", { name: "얼굴 수 늘리기" }));
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

describe("RoomStage 발표자료 공유", () => {
  const present = { presentationId: "pres-1", page: 2, pageCount: 5 };

  function renderPresent(opts?: {
    currentMemberId?: string;
    onChangePage?: () => void;
  }) {
    return render(
      <RoomStage
        members={members}
        presenterId="jo"
        currentMemberId={opts?.currentMemberId ?? "ha"}
        hands={new Set()}
        present={present}
        onChangePage={opts?.onChangePage}
      />,
    );
  }

  it("발표 상태가 있으면 해당 페이지 이미지를 무대에 띄운다", () => {
    lk.participants = [{ identity: "jo" }, { identity: "ha" }];
    const { container } = renderPresent();
    const img = container.querySelector("img");
    expect(img).not.toBeNull();
    expect(img?.getAttribute("src")).toBe("/api/presentations/pres-1/pages/2");
  });

  it("발표자료 공유는 화면공유보다 우선한다(영상 대신 슬라이드)", () => {
    lk.participants = [{ identity: "jo" }, { identity: "ha" }];
    lk.tracks = [share()]; // 화면공유 트랙이 있어도
    const { container } = renderPresent();
    // 슬라이드 이미지가 무대에 뜬다(발표자료 우선).
    expect(container.querySelector("img")?.getAttribute("src")).toBe(
      "/api/presentations/pres-1/pages/2",
    );
  });

  it("발표자에겐 페이지 네비(이전/다음)가 있고 클릭 시 onChangePage 호출", () => {
    lk.participants = [{ identity: "jo" }, { identity: "ha" }];
    const onChangePage = vi.fn();
    renderPresent({ currentMemberId: "jo", onChangePage });

    fireEvent.click(screen.getByRole("button", { name: "다음 페이지" }));
    expect(onChangePage).toHaveBeenCalledWith(3); // page 2 → 3

    fireEvent.click(screen.getByRole("button", { name: "이전 페이지" }));
    expect(onChangePage).toHaveBeenCalledWith(1); // page 2 → 1
  });

  it("시청자에겐 페이지 네비 버튼이 없고 위치만 표시한다", () => {
    lk.participants = [{ identity: "jo" }, { identity: "ha" }];
    renderPresent({ currentMemberId: "ha" }); // onChangePage 없음 = 시청자
    expect(screen.queryByRole("button", { name: "다음 페이지" })).toBeNull();
    expect(screen.getByText("2 / 5")).toBeInTheDocument();
  });

  it("발표자는 키보드 ←/→로도 페이지를 넘긴다", () => {
    lk.participants = [{ identity: "jo" }, { identity: "ha" }];
    const onChangePage = vi.fn();
    renderPresent({ currentMemberId: "jo", onChangePage });

    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(onChangePage).toHaveBeenCalledWith(3); // page 2 → 3

    fireEvent.keyDown(window, { key: "ArrowLeft" });
    expect(onChangePage).toHaveBeenCalledWith(1); // page 2 → 1
  });

  it("시청자 키보드 ←/→는 페이지를 넘기지 않는다", () => {
    lk.participants = [{ identity: "jo" }, { identity: "ha" }];
    const onChangePage = vi.fn();
    renderPresent({ currentMemberId: "ha" }); // onChangePage 없음 = 시청자

    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(onChangePage).not.toHaveBeenCalled();
  });

  it("발표 중에도 얼굴 스트립(−/+)이 함께 보인다", () => {
    lk.participants = [{ identity: "jo" }, { identity: "ha" }, { identity: "bak" }];
    renderPresent();
    expect(
      screen.getByRole("button", { name: "얼굴 수 늘리기" }),
    ).toBeInTheDocument();
  });
});

describe("RoomStage 내 얼굴 숨기기", () => {
  function renderHidden(extra?: {
    present?: { presentationId: string; page: number; pageCount: number };
  }) {
    return render(
      <RoomStage
        members={members}
        presenterId="jo"
        currentMemberId="ha"
        hands={new Set()}
        hideSelf
        present={extra?.present}
      />,
    );
  }

  it("그리드에서 내 타일만 빠지고 친구들은 그대로 보인다", () => {
    lk.participants = [{ identity: "jo" }, { identity: "ha" }, { identity: "bak" }];
    const { container } = renderHidden();

    expect(container.querySelector('[data-identity="ha"]')).toBeNull();
    expect(container.querySelector('[data-identity="jo"]')).not.toBeNull();
    expect(container.querySelector('[data-identity="bak"]')).not.toBeNull();
  });

  it("발표 중 얼굴 스트립 후보에서도 내가 빠진다", () => {
    lk.participants = [{ identity: "jo" }, { identity: "ha" }, { identity: "bak" }];
    const { container } = renderHidden({
      present: { presentationId: "pres-1", page: 1, pageCount: 3 },
    });

    // 기본 2명: 숨기지 않았다면 jo(발표자)·ha 순서지만, 숨기면 jo·bak이 뜬다.
    expect(container.querySelectorAll("[data-identity]")).toHaveLength(2);
    expect(container.querySelector('[data-identity="ha"]')).toBeNull();
    expect(container.querySelector('[data-identity="bak"]')).not.toBeNull();
    // 개수 한도도 친구 수(2명) 기준 — 더 늘릴 수 없다.
    expect(screen.getByRole("button", { name: "얼굴 수 늘리기" })).toBeDisabled();
  });

  it("혼자 있는 방에서 숨기면 따뜻한 안내를 보여준다", () => {
    lk.participants = [{ identity: "ha" }];
    renderHidden();
    expect(screen.getByText(/내 얼굴을 숨겼어요/)).toBeInTheDocument();
  });

  it("숨기지 않으면 내 타일이 그대로 보인다", () => {
    lk.participants = [{ identity: "jo" }, { identity: "ha" }];
    const { container } = renderStage(); // hideSelf 없음
    expect(container.querySelector('[data-identity="ha"]')).not.toBeNull();
  });
});

describe("RoomStage 전체화면", () => {
  // JSDOM은 Fullscreen API 미구현 — requestFullscreen이 호출되면 그 요소를
  // fullscreenElement로 두고 fullscreenchange를 디스패치해 실제 동작을 흉내낸다.
  let reqSpy: ReturnType<typeof vi.fn>;
  let exitSpy: ReturnType<typeof vi.fn>;

  function setFsElement(el: Element | null) {
    Object.defineProperty(document, "fullscreenElement", {
      configurable: true,
      value: el,
    });
  }

  beforeEach(() => {
    setFsElement(null);
    reqSpy = vi.fn(function (this: Element) {
      setFsElement(this);
      document.dispatchEvent(new Event("fullscreenchange"));
      return Promise.resolve();
    });
    exitSpy = vi.fn(() => {
      setFsElement(null);
      document.dispatchEvent(new Event("fullscreenchange"));
      return Promise.resolve();
    });
    Element.prototype.requestFullscreen =
      reqSpy as unknown as typeof Element.prototype.requestFullscreen;
    (document as { exitFullscreen: typeof document.exitFullscreen }).exitFullscreen =
      exitSpy as unknown as typeof document.exitFullscreen;
  });

  afterEach(() => {
    delete (Element.prototype as Partial<Element>).requestFullscreen;
    delete (document as Partial<Document>).exitFullscreen;
    setFsElement(null);
  });

  it("화면공유 중엔 전체화면 버튼을 보이고, 공유가 없으면 없다", () => {
    lk.participants = [{ identity: "jo" }, { identity: "ha" }];
    lk.tracks = [share()];
    const { rerender } = renderStage();
    expect(
      screen.getByRole("button", { name: "전체화면" }),
    ).toBeInTheDocument();

    lk.tracks = [];
    rerender(
      <RoomStage
        members={members}
        presenterId="jo"
        currentMemberId="ha"
        hands={new Set()}
      />,
    );
    expect(screen.queryByRole("button", { name: "전체화면" })).toBeNull();
  });

  it("전체화면 버튼: 클릭하면 requestFullscreen, 다시 누르면 exitFullscreen", () => {
    lk.participants = [{ identity: "jo" }, { identity: "ha" }];
    lk.tracks = [share()];
    renderStage();

    fireEvent.click(screen.getByRole("button", { name: "전체화면" }));
    expect(reqSpy).toHaveBeenCalledTimes(1);

    // 진입 후 버튼은 '종료'로 바뀐다.
    const exitBtn = screen.getByRole("button", { name: "전체화면 종료" });
    fireEvent.click(exitBtn);
    expect(exitSpy).toHaveBeenCalledTimes(1);
    expect(
      screen.getByRole("button", { name: "전체화면" }),
    ).toBeInTheDocument();
  });

  it("전체화면에서도 얼굴 스트립(−/+)이 따라온다", () => {
    lk.participants = [
      { identity: "jo" },
      { identity: "ha" },
      { identity: "bak" },
    ];
    lk.tracks = [share()];
    const { container } = renderStage();

    fireEvent.click(screen.getByRole("button", { name: "전체화면" }));
    // 진입 후에도 얼굴·개수 컨트롤이 그대로 있다.
    expect(
      screen.getByRole("button", { name: "얼굴 수 늘리기" }),
    ).toBeInTheDocument();
    expect(
      container.querySelectorAll("[data-identity]").length,
    ).toBeGreaterThanOrEqual(1);
  });
});
