import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { Avatar } from "../avatar";
import { Badge } from "../badge";
import { Button } from "../button";
import { EmptyState } from "../empty-state";
import { Input } from "../input";

describe("Button", () => {
  it("renders each variant with its tone via data-variant", () => {
    const variants = ["primary", "secondary", "ghost", "danger"] as const;
    for (const v of variants) {
      const { unmount } = render(<Button variant={v}>{v}</Button>);
      expect(screen.getByRole("button", { name: v })).toHaveAttribute(
        "data-variant",
        v,
      );
      unmount();
    }
  });

  it("defaults to type=button to avoid accidental form submits", () => {
    render(<Button>저장</Button>);
    expect(screen.getByRole("button", { name: "저장" })).toHaveAttribute(
      "type",
      "button",
    );
  });
});

describe("Avatar", () => {
  it("exposes an aria-label with the member name", () => {
    render(
      <Avatar user={{ name: "조성민", initial: "조", color: "var(--m-jo)" }} />,
    );
    expect(screen.getByRole("img", { name: "조성민 아바타" })).toBeInTheDocument();
  });
});

describe("Badge", () => {
  it("renders a label so it does not rely on color alone (R29)", () => {
    render(<Badge variant="guest">게스트</Badge>);
    expect(screen.getByText("게스트")).toBeInTheDocument();
  });

  it("pairs status color with a text label", () => {
    render(<Badge variant="online">온라인</Badge>);
    expect(screen.getByText("온라인")).toBeInTheDocument();
  });
});

describe("Input", () => {
  it("renders an editable text input", () => {
    render(<Input placeholder="이메일" />);
    expect(screen.getByPlaceholderText("이메일")).toBeInTheDocument();
  });
});

describe("EmptyState", () => {
  it("renders the title and the single CTA action", () => {
    render(
      <EmptyState
        title="아직 올라온 논문이 없어요"
        action={<Button>첫 PDF 올리기</Button>}
      />,
    );
    expect(screen.getByText("아직 올라온 논문이 없어요")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "첫 PDF 올리기" }),
    ).toBeInTheDocument();
  });
});
