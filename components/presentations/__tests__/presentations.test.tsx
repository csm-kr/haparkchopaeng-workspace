import { describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { CommentThread } from "../comment-thread";
import { PresentationList } from "../presentation-list";
import { SlideDeck } from "../slide-deck";
import { parseMentions } from "../mentions";
import type { CommentView, MemberRef, SlideView } from "../types";

// 발표 자료 — 목록 개수·댓글 스레드 렌더·@멘션 링크화·반응 토글·작성자 세션 주입·빈값 인라인 검증.
// 읽기 데이터는 props로, 쓰기는 주입한 mock 액션으로 검증한다(ADR-015).

const ha: MemberRef = {
  id: "ha",
  name: "하수현",
  handle: "@hajieun",
  initial: "하",
  color: "var(--m-ha)",
};
const jo: MemberRef = {
  id: "jo",
  name: "조성민",
  handle: "@chominho",
  initial: "조",
  color: "var(--m-jo)",
};
const members = [ha, jo];

describe("PresentationList", () => {
  it("개수와 항목을 표시하고 상세로 링크한다", () => {
    render(
      <PresentationList
        presentations={[
          {
            id: "pres1",
            title: "MoD 리뷰",
            date: "2026-06-13T07:00:00.000Z",
            duration: "30분",
            slideCount: 12,
            tags: ["주간세미나"],
            presenter: jo,
          },
          {
            id: "pres2",
            title: "Diffusion Forcing",
            date: "2026-06-12T07:00:00.000Z",
            duration: null,
            slideCount: 9,
            tags: [],
            presenter: ha,
          },
        ]}
      />,
    );
    expect(screen.getByText("2개")).toBeInTheDocument();
    const link = screen.getByRole("link", { name: /MoD 리뷰/ });
    expect(link).toHaveAttribute("href", "/presentations/pres1");
  });

  it("빈 목록은 정직한 빈 상태를 보인다", () => {
    render(<PresentationList presentations={[]} />);
    expect(screen.getByText("발표 자료가 아직 없어요")).toBeInTheDocument();
  });
});

describe("SlideDeck 슬라이드 이동", () => {
  const slides: SlideView[] = [
    { title: "표지", subtitle: null, body: "첫 장" },
    { title: "방법", subtitle: "Method", body: "둘째 장" },
    { title: "결과", subtitle: null, body: "셋째 장" },
  ];

  it("처음엔 1번 슬라이드를 보이고 이전은 비활성이다", () => {
    render(<SlideDeck slides={slides} />);
    expect(screen.getByText("첫 장")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /이전/ })).toBeDisabled();
  });

  it("다음을 누르면 다음 슬라이드로 넘어간다", () => {
    render(<SlideDeck slides={slides} />);
    fireEvent.click(screen.getByRole("button", { name: /다음/ }));
    expect(screen.getByText("둘째 장")).toBeInTheDocument();
  });

  it("썸네일을 누르면 해당 슬라이드로 점프하고 마지막에선 다음이 비활성이다", () => {
    render(<SlideDeck slides={slides} />);
    fireEvent.click(screen.getByLabelText("3번 슬라이드"));
    expect(screen.getByText("셋째 장")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /다음/ })).toBeDisabled();
  });
});

describe("parseMentions", () => {
  it("이름·핸들 멘션은 멤버로 해소하고 미매칭 @는 텍스트로 둔다", () => {
    const segs = parseMentions("@하수현 보세요 @chominho @없는사람", members);
    const mentions = segs.filter((s) => s.type === "mention");
    expect(mentions).toHaveLength(2);
    // 미매칭 토큰은 텍스트에 그대로 남는다.
    expect(segs.some((s) => s.type === "text" && s.value.includes("@없는사람"))).toBe(
      true,
    );
  });
});

function baseComments(): CommentView[] {
  return [
    {
      id: "c1",
      body: "Result 2 그래프 한 장 더 있으면 좋겠어요 @조성민",
      slide: 7,
      createdAt: "2026-06-13T06:00:00.000Z",
      author: ha,
      reactions: [{ id: "r1", emoji: "👍", member: ha }],
    },
  ];
}

function renderThread(
  overrides: Partial<React.ComponentProps<typeof CommentThread>> = {},
) {
  const addComment = vi.fn(async (input) => ({
    id: "server-id",
    body: input.body,
    slide: input.slide,
    createdAt: "2026-06-13T07:00:00.000Z",
    author: jo,
    reactions: [],
  }));
  const toggleReaction = vi.fn(async () => []);
  render(
    <CommentThread
      presentationId="pres1"
      comments={baseComments()}
      members={members}
      currentUser={jo}
      addComment={addComment}
      toggleReaction={toggleReaction}
      {...overrides}
    />,
  );
  return { addComment, toggleReaction };
}

describe("CommentThread 렌더", () => {
  it("기존 댓글을 작성자·슬라이드 참조와 함께 보인다", () => {
    renderThread();
    expect(screen.getByText(/Result 2 그래프/)).toBeInTheDocument();
    expect(screen.getByText("하수현")).toBeInTheDocument();
    expect(screen.getByText("슬라이드 7")).toBeInTheDocument();
  });

  it("@멘션을 팀 링크로 링크화한다", () => {
    renderThread();
    const mention = screen.getByRole("link", { name: "@조성민" });
    expect(mention).toHaveAttribute("href", "/team");
  });
});

describe("CommentThread 작성", () => {
  it("빈 내용은 인라인 안내를 보이고 addComment를 호출하지 않는다", () => {
    const { addComment } = renderThread();
    fireEvent.click(screen.getByRole("button", { name: "보내기" }));
    expect(screen.getByRole("alert")).toHaveTextContent("내용을 입력해주세요.");
    expect(addComment).not.toHaveBeenCalled();
  });

  it("유효한 댓글은 세션 사용자로 낙관적 표시되고 authorId 없이 호출된다", async () => {
    const { addComment } = renderThread();
    fireEvent.change(screen.getByLabelText("댓글 내용"), {
      target: { value: "좋은 발표였어요" },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "보내기" }));
    });
    // 낙관적으로 표시(작성자 = 현재 사용자 조성민).
    expect(screen.getByText("좋은 발표였어요")).toBeInTheDocument();
    // 작성자는 클라가 보내지 않는다 — body/slide/presentationId만(R3).
    expect(addComment).toHaveBeenCalledWith({
      presentationId: "pres1",
      body: "좋은 발표였어요",
      slide: null,
    });
  });
});

describe("CommentThread 반응 토글", () => {
  it("기존 반응 알약을 누르면 emoji로 toggleReaction을 호출한다", async () => {
    const { toggleReaction } = renderThread();
    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: /👍 반응 1개/ }),
      );
    });
    expect(toggleReaction).toHaveBeenCalledWith({
      presentationId: "pres1",
      commentId: "c1",
      emoji: "👍",
    });
  });
});
