import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

// ChatPanel 단위 테스트 — 휘발 채팅(미저장). 작성자는 LiveKit identity로 판별해 members에서
// 이름/아바타 매핑(R3: 페이로드 author 미신뢰). 빈 상태(R26) + Enter 전송 + 빈 값 무시.

const { ChatPanel } = await import("@/components/live/chat-panel");

const members = [
  { id: "ha", name: "하수현", initial: "하", color: "var(--m-ha)" },
  { id: "jo", name: "조성민", initial: "조", color: "var(--m-jo)" },
];

afterEach(() => cleanup());

describe("ChatPanel", () => {
  it("메시지가 없으면 정직한 빈 상태(R26)", () => {
    render(<ChatPanel messages={[]} members={members} onSend={vi.fn()} />);
    expect(screen.getByText(/아직 채팅이 없어요/)).toBeInTheDocument();
  });

  it("identity로 작성자 이름을 매핑해 표시한다(R3)", () => {
    render(
      <ChatPanel
        messages={[{ id: "m1", identity: "jo", text: "안녕하세요", at: 1 }]}
        members={members}
        onSend={vi.fn()}
      />,
    );
    expect(screen.getByText("조성민")).toBeInTheDocument();
    expect(screen.getByText("안녕하세요")).toBeInTheDocument();
  });

  it("members에 없는 identity는 identity를 그대로 보여준다(폴백)", () => {
    render(
      <ChatPanel
        messages={[{ id: "m1", identity: "ghost", text: "hi", at: 1 }]}
        members={members}
        onSend={vi.fn()}
      />,
    );
    expect(screen.getByText("ghost")).toBeInTheDocument();
  });

  it("입력 후 Enter → onSend(text) 호출 + 입력 비움", () => {
    const onSend = vi.fn();
    render(<ChatPanel messages={[]} members={members} onSend={onSend} />);
    const input = screen.getByPlaceholderText(/메시지/) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "들립니다 👍" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onSend).toHaveBeenCalledWith("들립니다 👍");
    expect(input.value).toBe("");
  });

  it("빈 값 Enter는 무시(인라인 검증, onSend 미호출)", () => {
    const onSend = vi.fn();
    render(<ChatPanel messages={[]} members={members} onSend={onSend} />);
    const input = screen.getByPlaceholderText(/메시지/);
    fireEvent.change(input, { target: { value: "   " } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onSend).not.toHaveBeenCalled();
  });
});
