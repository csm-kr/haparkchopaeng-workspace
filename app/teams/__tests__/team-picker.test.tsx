import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { TeamPicker } from "../team-picker";

// 팀 허브 선택 섬(ADR-021) — team-switcher와 동일 패턴.
// 선택은 POST /api/teams/active {slug}로 활성 팀 쿠키를 바꾼 뒤 /dashboard로 이동한다.
// CRITICAL: 멤버십 검증은 기존 /api/teams/active 서버가 하므로(R19), 여기선 새 검증 경로 없음.
const { pushMock } = vi.hoisted(() => ({ pushMock: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: pushMock }) }));

const fetchMock = vi.fn(async () => ({ ok: true }) as unknown as Response);

const TEAMS = [
  { slug: "alpha", name: "알파", role: "owner" },
  { slug: "beta", name: "베타", role: "member" },
];

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", fetchMock);
});

describe("TeamPicker", () => {
  it("팀이 없으면 아무것도 렌더하지 않는다", () => {
    const { container } = render(<TeamPicker teams={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("팀 목록을 선택 버튼으로 렌더한다", () => {
    render(<TeamPicker teams={TEAMS} />);
    expect(screen.getByRole("button", { name: /알파/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /베타/ })).toBeInTheDocument();
  });

  it("팀 클릭 → POST /api/teams/active {slug} 후 /dashboard로 이동", async () => {
    render(<TeamPicker teams={TEAMS} />);
    fireEvent.click(screen.getByRole("button", { name: /알파/ }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/teams/active");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({ slug: "alpha" });
    await waitFor(() => expect(pushMock).toHaveBeenCalledWith("/dashboard"));
  });
});
