import { describe, expect, it } from "vitest";

import { MEMBER_COLORS, pickMemberColor } from "@/lib/member-color";

// 멤버 아바타 색 — 팔레트에서 seed로 결정적 선택(모든 아바타가 같은 색이 되지 않도록).

describe("pickMemberColor()", () => {
  it("팔레트(globals.css --m-*) 안의 색을 돌려준다", () => {
    expect(MEMBER_COLORS).toContain(pickMemberColor("alice@x.team"));
  });

  it("같은 seed는 항상 같은 색을 준다(결정적)", () => {
    expect(pickMemberColor("alice@x.team")).toBe(pickMemberColor("alice@x.team"));
  });

  it("서로 다른 seed들은 한 색으로 쏠리지 않고 팔레트에 분산된다", () => {
    const seeds = ["a", "b", "c", "d", "e", "f", "g", "h"];
    const used = new Set(seeds.map(pickMemberColor));
    expect(used.size).toBe(MEMBER_COLORS.length);
  });
});
