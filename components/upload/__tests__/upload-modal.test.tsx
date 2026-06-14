import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { UploadButton } from "../upload-modal";

// next/navigation을 고정 — 업로드 완료 시 push 호출만 확인한다.
const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
}));

function makeFile(name: string, type: string): File {
  return new File(["%PDF-1.7 dummy"], name, { type });
}

function pickFile(file: File) {
  const input = screen.getByLabelText("PDF 파일 선택") as HTMLInputElement;
  fireEvent.change(input, { target: { files: [file] } });
}

describe("UploadButton / UploadModal", () => {
  beforeEach(() => {
    push.mockReset();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("버튼을 누르면 PDF 드롭존과 arXiv 입력이 보인다", () => {
    render(<UploadButton />);
    fireEvent.click(screen.getByRole("button", { name: "논문 올리기" }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByLabelText("PDF 파일 선택")).toBeInTheDocument();
    // arXiv URL 입력 필드(드래그앤드롭 또는 arXiv URL — ADR-003)
    expect(screen.getByLabelText("arXiv 주소")).toBeInTheDocument();
  });

  it("PDF가 아닌 파일은 인라인 에러로 거부하고 업로드를 시도하지 않는다(R12/ADR-003)", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    render(<UploadButton />);
    fireEvent.click(screen.getByRole("button", { name: "논문 올리기" }));

    pickFile(makeFile("slides.pptx", "application/vnd.ms-powerpoint"));

    expect(screen.getByText("PDF만 올릴 수 있어요.")).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("PDF를 고르면 프리사인→직접 업로드→Paper 생성 단계를 거쳐 상세로 이동한다", async () => {
    const fetchMock = vi
      .fn()
      // 1) presign
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: { uploadUrl: "https://store/sign/abc", path: "papers/abc.pdf" },
        }),
      })
      // 2) 서명 URL로 직접 PUT 업로드
      .mockResolvedValueOnce({ ok: true })
      // 3) POST /api/papers
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: { id: "newpaper", analysisStatus: "pending" } }),
      });
    vi.stubGlobal("fetch", fetchMock);

    render(<UploadButton />);
    fireEvent.click(screen.getByRole("button", { name: "논문 올리기" }));
    pickFile(makeFile("mod.pdf", "application/pdf"));

    await waitFor(() => expect(push).toHaveBeenCalledWith("/papers/newpaper"));

    // 프리사인 → POST /api/papers 호출 확인(직접 업로드는 서명 URL로 PUT).
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/uploads/presign",
      expect.objectContaining({ method: "POST" }),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/papers",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("arXiv URL을 제출하면 서버(/api/papers)가 가져오고 상세로 이동한다", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: { id: "arxpaper", analysisStatus: "pending" } }),
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<UploadButton />);
    fireEvent.click(screen.getByRole("button", { name: "논문 올리기" }));
    fireEvent.change(screen.getByLabelText("arXiv 주소"), {
      target: { value: "https://arxiv.org/abs/2404.02258" },
    });
    fireEvent.click(screen.getByRole("button", { name: "가져오기" }));

    await waitFor(() => expect(push).toHaveBeenCalledWith("/papers/arxpaper"));
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/papers",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("파일 업로드가 한도 초과(429)면 서버 메시지를 그대로 보여준다", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: { uploadUrl: "https://store/sign/abc", path: "papers/abc.pdf" },
        }),
      })
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce({
        ok: false,
        status: 429,
        json: async () => ({
          error: {
            code: "TOO_MANY_REQUESTS",
            message: "이번 주 분석 한도(20편)를 다 썼어요.",
          },
        }),
      });
    vi.stubGlobal("fetch", fetchMock);

    render(<UploadButton />);
    fireEvent.click(screen.getByRole("button", { name: "논문 올리기" }));
    pickFile(makeFile("mod.pdf", "application/pdf"));

    await waitFor(() =>
      expect(
        screen.getByText("이번 주 분석 한도(20편)를 다 썼어요."),
      ).toBeInTheDocument(),
    );
    expect(push).not.toHaveBeenCalled();
  });

  it("arXiv 가져오기가 30쪽 초과(413)면 서버 메시지를 그대로 보여준다", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: false,
      status: 413,
      json: async () => ({
        error: {
          code: "PDF_TOO_LONG",
          message: "30쪽 이하 PDF만 올릴 수 있어요. (지금 42쪽)",
        },
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<UploadButton />);
    fireEvent.click(screen.getByRole("button", { name: "논문 올리기" }));
    fireEvent.change(screen.getByLabelText("arXiv 주소"), {
      target: { value: "https://arxiv.org/abs/2404.02258" },
    });
    fireEvent.click(screen.getByRole("button", { name: "가져오기" }));

    await waitFor(() =>
      expect(
        screen.getByText("30쪽 이하 PDF만 올릴 수 있어요. (지금 42쪽)"),
      ).toBeInTheDocument(),
    );
    expect(push).not.toHaveBeenCalled();
  });

  it("빈 arXiv URL은 인라인 검증으로 막는다(R30)", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    render(<UploadButton />);
    fireEvent.click(screen.getByRole("button", { name: "논문 올리기" }));
    fireEvent.click(screen.getByRole("button", { name: "가져오기" }));

    expect(screen.getByText("arXiv 주소를 입력해주세요.")).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("quota를 주면 이번 주 분석 사용량을 보여준다", () => {
    render(<UploadButton quota={{ limit: 20, used: 7, remaining: 13 }} />);
    fireEvent.click(screen.getByRole("button", { name: "논문 올리기" }));
    expect(screen.getByText("7/20")).toBeInTheDocument();
  });

  it("한도를 다 쓰면(remaining 0) 안내하고 업로드를 막는다", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    render(<UploadButton quota={{ limit: 20, used: 20, remaining: 0 }} />);
    fireEvent.click(screen.getByRole("button", { name: "논문 올리기" }));
    expect(screen.getByText(/한도를 다 썼어요/)).toBeInTheDocument();
    // 한도 소진 상태에서 PDF를 골라도 업로드(fetch)를 시도하지 않는다
    pickFile(makeFile("mod.pdf", "application/pdf"));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByText("이번 주 분석 한도를 다 썼어요.")).toBeInTheDocument();
  });
});
