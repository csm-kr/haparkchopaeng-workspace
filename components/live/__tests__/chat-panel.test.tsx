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
    render(<ChatPanel messages={[]} members={members} onSendImage={vi.fn()} onSend={vi.fn()} />);
    expect(screen.getByText(/아직 채팅이 없어요/)).toBeInTheDocument();
  });

  it("identity로 작성자 이름을 매핑해 표시한다(R3)", () => {
    render(
      <ChatPanel
        messages={[{ id: "m1", identity: "jo", text: "안녕하세요", at: 1 }]}
        members={members}
        onSendImage={vi.fn()} onSend={vi.fn()}
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
        onSendImage={vi.fn()} onSend={vi.fn()}
      />,
    );
    expect(screen.getByText("ghost")).toBeInTheDocument();
  });

  it("입력 후 Enter → onSend(text) 호출 + 입력 비움", () => {
    const onSend = vi.fn();
    render(<ChatPanel messages={[]} members={members} onSendImage={vi.fn()} onSend={onSend} />);
    const input = screen.getByPlaceholderText(/메시지/) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "들립니다 👍" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onSend).toHaveBeenCalledWith("들립니다 👍");
    expect(input.value).toBe("");
  });

  it("빈 값 Enter는 무시(인라인 검증, onSend 미호출)", () => {
    const onSend = vi.fn();
    render(<ChatPanel messages={[]} members={members} onSendImage={vi.fn()} onSend={onSend} />);
    const input = screen.getByPlaceholderText(/메시지/);
    fireEvent.change(input, { target: { value: "   " } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onSend).not.toHaveBeenCalled();
  });

  it("IME 조합 중(isComposing) Enter는 전송하지 않는다 — 한글 마지막 음절 중복 방지", () => {
    const onSend = vi.fn();
    render(<ChatPanel messages={[]} members={members} onSendImage={vi.fn()} onSend={onSend} />);
    const input = screen.getByPlaceholderText(/메시지/) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "대박" } });
    // 한글 조합 중 Enter는 IME 확정용 — 전송하면 "대박" + 남은 "박"으로 쪼개진다.
    fireEvent.keyDown(input, { key: "Enter", isComposing: true });
    expect(onSend).not.toHaveBeenCalled();
    // 조합이 끝난 뒤 Enter에만 전송한다.
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onSend).toHaveBeenCalledTimes(1);
    expect(onSend).toHaveBeenCalledWith("대박");
  });
});

// ── 이미지 첨부(휘발) ────────────────────────────────────────────────
// CRITICAL: 이미지는 서버에 저장하지 않는다(R21) — 룸 참가자에게 직접 보내고 blob URL로 그린다.
// CRITICAL: 형식·크기 검증은 보내기 전에 한다 — 통과 못한 파일은 상대 대역폭을 쓰지 않는다.

const { MAX_IMAGE_BYTES } = await import("@/lib/live-image");

function pickFile(file: File) {
  const input = screen.getByLabelText("이미지 첨부") as HTMLInputElement;
  fireEvent.change(input, { target: { files: [file] } });
}

describe("ChatPanel 이미지", () => {
  it("imageUrl이 있는 메시지는 이미지를 보여준다", () => {
    render(
      <ChatPanel
        messages={[
          { id: "m1", identity: "jo", text: "", imageUrl: "blob:abc", at: 1 },
        ]}
        members={members}
        onSend={vi.fn()}
        onSendImage={vi.fn()}
      />,
    );
    const img = screen.getByAltText("조성민 님이 보낸 이미지");
    expect(img).toHaveAttribute("src", "blob:abc");
  });

  it("이미지와 글이 함께 온 메시지는 둘 다 보여준다", () => {
    render(
      <ChatPanel
        messages={[
          { id: "m1", identity: "jo", text: "이거 봐요", imageUrl: "blob:abc", at: 1 },
        ]}
        members={members}
        onSend={vi.fn()}
        onSendImage={vi.fn()}
      />,
    );
    expect(screen.getByText("이거 봐요")).toBeInTheDocument();
    expect(screen.getByAltText("조성민 님이 보낸 이미지")).toBeInTheDocument();
  });

  it("이미지를 고르면 onSendImage(file)를 호출한다", () => {
    const onSendImage = vi.fn();
    render(
      <ChatPanel messages={[]} members={members} onSend={vi.fn()} onSendImage={onSendImage} />,
    );
    const file = new File(["hello"], "shot.png", { type: "image/png" });
    pickFile(file);
    expect(onSendImage).toHaveBeenCalledWith(file);
  });

  it("이미지가 아닌 파일은 보내지 않고 이유를 알려준다(R30)", () => {
    const onSendImage = vi.fn();
    render(
      <ChatPanel messages={[]} members={members} onSend={vi.fn()} onSendImage={onSendImage} />,
    );
    pickFile(new File(["x"], "paper.pdf", { type: "application/pdf" }));
    expect(onSendImage).not.toHaveBeenCalled();
    expect(screen.getByText(/이미지 파일만/)).toBeInTheDocument();
  });

  it("너무 큰 이미지는 보내지 않고 이유를 알려준다(R30)", () => {
    const onSendImage = vi.fn();
    render(
      <ChatPanel messages={[]} members={members} onSend={vi.fn()} onSendImage={onSendImage} />,
    );
    const big = new File(["x"], "big.png", { type: "image/png" });
    Object.defineProperty(big, "size", { value: MAX_IMAGE_BYTES + 1 });
    pickFile(big);
    expect(onSendImage).not.toHaveBeenCalled();
    expect(screen.getByText(/5MB/)).toBeInTheDocument();
  });

  it("거절된 뒤 올바른 이미지를 고르면 안내가 사라지고 전송된다", () => {
    const onSendImage = vi.fn();
    render(
      <ChatPanel messages={[]} members={members} onSend={vi.fn()} onSendImage={onSendImage} />,
    );
    pickFile(new File(["x"], "paper.pdf", { type: "application/pdf" }));
    expect(screen.getByText(/이미지 파일만/)).toBeInTheDocument();

    pickFile(new File(["x"], "ok.png", { type: "image/png" }));
    expect(onSendImage).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(/이미지 파일만/)).not.toBeInTheDocument();
  });

  it("글 없이 이미지만 있는 메시지는 빈 문단을 만들지 않는다", () => {
    render(
      <ChatPanel
        messages={[{ id: "m1", identity: "jo", text: "", imageUrl: "blob:abc", at: 1 }]}
        members={members}
        onSend={vi.fn()}
        onSendImage={vi.fn()}
      />,
    );
    // 이름 + 이미지만. 본문 문단은 없다.
    expect(screen.getByText("조성민")).toBeInTheDocument();
    expect(screen.getByAltText("조성민 님이 보낸 이미지")).toBeInTheDocument();
  });
});
