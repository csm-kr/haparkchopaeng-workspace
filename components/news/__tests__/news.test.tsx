import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { PublicationList } from "../publication-list";
import type { PublicationCardData } from "../publication-list";
import { PublicationForm } from "../publication-form";
import { TeaserView } from "../teaser-view";

// NEWS UI — 목록 카드(+빈 상태 CTA)·저자 강조·추가/편집 폼(프리사인 업로드·링크 행)·티저 상세.
// 데이터는 props로만 받는다(ADR-015). 쓰기는 프리사인→PUT→API(R36). 읽기/서명 URL은 step 4 RSC가 한다.

// next/navigation 고정 — 폼/삭제 메뉴/추가 버튼이 useRouter를 쓴다.
const push = vi.fn();
const refresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, refresh }),
}));

beforeEach(() => {
  push.mockReset();
  refresh.mockReset();
});
afterEach(() => {
  vi.restoreAllMocks();
});

const item: PublicationCardData = {
  id: "pub1",
  title: "Favoring One Among Equals",
  authorSegments: [
    { text: "조성민", isMember: true },
    { text: "Jane Roe", isMember: false },
  ],
  venue: "WACV 2024",
  year: 2025,
  month: 3,
  teaserUrl: null,
};

describe("PublicationList", () => {
  it("빈 목록은 정직한 빈 상태 + 추가 CTA를 보인다(R26)", () => {
    render(<PublicationList items={[]} />);
    expect(screen.getByText("아직 등록된 실적이 없어요")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "첫 실적 추가하기" }),
    ).toBeInTheDocument();
  });

  it("카드에 제목·학회·연월을 보이고 상세로 링크한다", () => {
    render(<PublicationList items={[item]} />);
    expect(screen.getByText("Favoring One Among Equals")).toBeInTheDocument();
    expect(screen.getByText("WACV 2024")).toBeInTheDocument();
    expect(screen.getByText("2025.03")).toBeInTheDocument();
    const link = screen.getByRole("link", {
      name: /Favoring One Among Equals/,
    });
    expect(link).toHaveAttribute("href", "/news/pub1");
  });

  it("월이 없으면 연도만 보인다", () => {
    render(<PublicationList items={[{ ...item, month: null }]} />);
    expect(screen.getByText("2025")).toBeInTheDocument();
  });

  it("팀원 저자만 강조한다(splitAuthors 결과)", () => {
    render(<PublicationList items={[item]} />);
    expect(screen.getByText("조성민")).toHaveAttribute("data-member");
    expect(screen.getByText("Jane Roe")).not.toHaveAttribute("data-member");
  });
});

describe("PublicationForm 검증", () => {
  it("제목·학회가 비면 인라인 에러를 보이고 요청하지 않는다(R30)", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    render(<PublicationForm />);
    fireEvent.click(screen.getByRole("button", { name: "저장" }));
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("PublicationForm 링크 행", () => {
  it("프리셋으로 링크 행을 추가하고 삭제한다", () => {
    render(<PublicationForm />);
    expect(screen.queryByLabelText("링크 1 URL")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "arXiv 링크 추가" }));
    expect(screen.getByLabelText("링크 1 URL")).toBeInTheDocument();
    expect(screen.getByLabelText("링크 1 라벨")).toHaveValue("arXiv");

    fireEvent.click(screen.getByRole("button", { name: "링크 1 삭제" }));
    expect(screen.queryByLabelText("링크 1 URL")).toBeNull();
  });
});

describe("PublicationForm 제출", () => {
  it("티저 파일이 있으면 presign(kind:news)→PUT→POST /api/news 순으로 호출하고 목록으로 이동한다(R36)", async () => {
    const fetchMock = vi
      .fn()
      // 1) presign
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: { uploadUrl: "https://store/sign/x", path: "news/x.png" },
        }),
      })
      // 2) 서명 URL로 직접 PUT
      .mockResolvedValueOnce({ ok: true })
      // 3) POST /api/news
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: { id: "newpub" } }),
      });
    vi.stubGlobal("fetch", fetchMock);

    render(<PublicationForm />);
    fireEvent.change(screen.getByLabelText("제목"), {
      target: { value: "내 논문" },
    });
    fireEvent.change(screen.getByLabelText("학회"), {
      target: { value: "NeurIPS 2025" },
    });
    fireEvent.change(screen.getByLabelText("저자"), {
      target: { value: "조성민" },
    });
    fireEvent.change(screen.getByLabelText("연도"), {
      target: { value: "2025" },
    });
    const file = new File(["x"], "teaser.png", { type: "image/png" });
    fireEvent.change(screen.getByLabelText("티저 이미지 선택"), {
      target: { files: [file] },
    });

    fireEvent.click(screen.getByRole("button", { name: "저장" }));

    await waitFor(() => expect(push).toHaveBeenCalledWith("/news"));

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/uploads/presign",
      expect.objectContaining({ method: "POST" }),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/news",
      expect.objectContaining({ method: "POST" }),
    );
    // 프리사인 요청은 kind:news
    const presignBody = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(presignBody.kind).toBe("news");
    // 생성 body의 teaserImage는 프리사인이 준 news/ 키
    const createBody = JSON.parse(fetchMock.mock.calls[2][1].body);
    expect(createBody.teaserImage).toBe("news/x.png");
    expect(refresh).toHaveBeenCalled();
  });

  it("편집은 파일을 새로 고르지 않으면 presign 없이 PATCH로 보내고 상세로 이동한다", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: { id: "pub1" } }),
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <PublicationForm
        initial={{
          id: "pub1",
          title: "T",
          venue: "V",
          authors: "조성민",
          year: 2025,
          month: 3,
          links: [],
          teaserUrl: "https://store/sign/old.png",
        }}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "저장" }));

    await waitFor(() => expect(push).toHaveBeenCalledWith("/news/pub1"));
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/news/pub1",
      expect.objectContaining({ method: "PATCH" }),
    );
    expect(fetchMock).not.toHaveBeenCalledWith(
      "/api/uploads/presign",
      expect.anything(),
    );
  });
});

const pub = {
  id: "pub1",
  title: "Favoring One Among Equals",
  authorSegments: [
    { text: "조성민", isMember: true },
    { text: "Jane Roe", isMember: false },
  ],
  venue: "WACV 2024",
  year: 2025,
  month: 3 as number | null,
  links: [
    { label: "arXiv", url: "https://arxiv.org/abs/1234" },
    { label: "코드", url: "https://github.com/x/y" },
  ],
  teaserUrl: "https://store/sign/abc.png",
};

describe("TeaserView", () => {
  it("티저 이미지·학회/연월·저자(강조)·외부 링크를 보인다", () => {
    render(<TeaserView publication={pub} canEdit={false} />);
    expect(screen.getByRole("img", { name: /Favoring One Among Equals/ })).toHaveAttribute(
      "src",
      "https://store/sign/abc.png",
    );
    expect(screen.getByText("WACV 2024")).toBeInTheDocument();
    expect(screen.getByText("2025.03")).toBeInTheDocument();
    expect(screen.getByText("조성민")).toHaveAttribute("data-member");
    const arxiv = screen.getByRole("link", { name: "arXiv" });
    expect(arxiv).toHaveAttribute("href", "https://arxiv.org/abs/1234");
    expect(arxiv).toHaveAttribute("target", "_blank");
  });

  it("티저 이미지가 없으면 플레이스홀더를 보인다", () => {
    render(<TeaserView publication={{ ...pub, teaserUrl: null }} canEdit={false} />);
    expect(screen.queryByRole("img")).toBeNull();
    expect(screen.getByTestId("teaser-placeholder")).toBeInTheDocument();
  });

  it("canEdit=false면 편집/삭제 액션이 없다", () => {
    render(<TeaserView publication={pub} canEdit={false} />);
    expect(screen.queryByRole("button", { name: "실적 편집" })).toBeNull();
    expect(screen.queryByRole("button", { name: "더보기" })).toBeNull();
  });

  it("canEdit=true면 편집·삭제 액션을 노출한다(R27 삭제는 확인)", () => {
    render(<TeaserView publication={pub} canEdit={true} />);
    expect(
      screen.getByRole("button", { name: "실적 편집" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "더보기" })).toBeInTheDocument();
  });
});
