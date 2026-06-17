import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { PaperTitleEditable } from "../paper-title";

// 논문 이름(제목) 인라인 편집 — 연필 버튼으로 입력창 열고 PATCH로 저장, 성공 시 화면 갱신.
// next/navigation을 고정 — 저장 성공 시 router.refresh 호출을 확인한다.
const refresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh }),
}));

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe("PaperTitleEditable", () => {
  it("기본은 제목을 h1로 보여준다", () => {
    render(<PaperTitleEditable paperId="p1" initialTitle="원래 제목" />);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("원래 제목");
  });

  it("이름 변경을 누르면 입력창이 열리고 현재 제목이 채워진다", () => {
    render(<PaperTitleEditable paperId="p1" initialTitle="원래 제목" />);
    fireEvent.click(screen.getByRole("button", { name: "이름 변경" }));
    expect(screen.getByRole("textbox")).toHaveValue("원래 제목");
  });

  it("저장하면 PATCH로 새 제목을 보내고 화면을 갱신한다", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: { id: "p1", title: "바뀐 제목" } }),
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<PaperTitleEditable paperId="p1" initialTitle="원래 제목" />);
    fireEvent.click(screen.getByRole("button", { name: "이름 변경" }));
    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "바뀐 제목" },
    });
    fireEvent.click(screen.getByRole("button", { name: "저장" }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/papers/p1",
        expect.objectContaining({ method: "PATCH" }),
      ),
    );
    const init = fetchMock.mock.calls[0][1] as { body: string };
    expect(JSON.parse(init.body)).toEqual({ title: "바뀐 제목" });

    // 성공하면 새 제목을 보여주고 서버 데이터 갱신을 요청한다.
    await waitFor(() =>
      expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
        "바뀐 제목",
      ),
    );
    expect(refresh).toHaveBeenCalled();
  });

  it("저장 시 앞뒤 공백을 잘라서 보낸다", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: { id: "p1", title: "다듬은" } }),
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<PaperTitleEditable paperId="p1" initialTitle="원래 제목" />);
    fireEvent.click(screen.getByRole("button", { name: "이름 변경" }));
    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "  다듬은  " },
    });
    fireEvent.click(screen.getByRole("button", { name: "저장" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const init = fetchMock.mock.calls[0][1] as { body: string };
    expect(JSON.parse(init.body)).toEqual({ title: "다듬은" });
  });

  it("취소하면 입력을 버리고 원래 제목으로 돌아온다", () => {
    render(<PaperTitleEditable paperId="p1" initialTitle="원래 제목" />);
    fireEvent.click(screen.getByRole("button", { name: "이름 변경" }));
    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "버릴 값" },
    });
    fireEvent.click(screen.getByRole("button", { name: "취소" }));
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("원래 제목");
  });

  it("빈 제목(공백뿐)이면 저장 버튼이 비활성화된다", () => {
    render(<PaperTitleEditable paperId="p1" initialTitle="원래 제목" />);
    fireEvent.click(screen.getByRole("button", { name: "이름 변경" }));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "   " } });
    expect(screen.getByRole("button", { name: "저장" })).toBeDisabled();
  });

  it("저장이 실패하면 에러를 보여주고 제목은 그대로 둔다", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      json: async () => ({ error: { code: "BAD_REQUEST", message: "안 됐어요." } }),
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<PaperTitleEditable paperId="p1" initialTitle="원래 제목" />);
    fireEvent.click(screen.getByRole("button", { name: "이름 변경" }));
    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "시도" },
    });
    fireEvent.click(screen.getByRole("button", { name: "저장" }));

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("안 됐어요."));
    expect(refresh).not.toHaveBeenCalled();
  });
});
