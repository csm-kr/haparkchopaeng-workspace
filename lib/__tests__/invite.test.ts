import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { signInvite, verifyInvite } from "@/lib/invite";

beforeAll(() => {
  process.env.INVITE_TOKEN_SECRET = "test-invite-secret";
});

afterEach(() => {
  vi.useRealTimers();
});

describe("signInvite / verifyInvite", () => {
  it("round-trips an invite payload", () => {
    const token = signInvite({ email: "new@university.ac.kr", role: "멤버", inviteId: "inv1" });
    expect(verifyInvite(token)).toEqual({
      email: "new@university.ac.kr",
      role: "멤버",
      inviteId: "inv1",
    });
  });

  it("rejects a forged token", () => {
    const token = signInvite({ email: "new@university.ac.kr", role: "멤버", inviteId: "inv1" });
    expect(verifyInvite(`${token}tampered`)).toBeNull();
  });

  it("rejects an expired token", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-13T00:00:00Z"));
    const token = signInvite({ email: "new@university.ac.kr", role: "게스트", inviteId: "inv2" });
    vi.setSystemTime(new Date("2026-06-21T00:00:00Z")); // +8일 > 7일 TTL
    expect(verifyInvite(token)).toBeNull();
  });
});
